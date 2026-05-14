#[cfg(all(target_os = "macos", not(feature = "keychain")))]
mod file_store {
    use keyring_core::api::{CredentialApi, CredentialPersistence, CredentialStoreApi};
    use keyring_core::{Credential, CredentialStore, Entry, Error, Result};
    use std::any::Any;
    use std::collections::HashMap;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::Arc;

    fn credential_path(base: &PathBuf, service: &str, user: &str) -> PathBuf {
        let safe = |s: &str| s.replace(['/', '\\', '\0', ':'], "_");
        base.join("credentials")
            .join(safe(service))
            .join(safe(user))
    }

    #[derive(Debug, Clone)]
    pub struct FileCredential {
        service: String,
        user: String,
        base: PathBuf,
    }

    impl CredentialApi for FileCredential {
        fn set_secret(&self, secret: &[u8]) -> Result<()> {
            let path = credential_path(&self.base, &self.service, &self.user);
            fs::create_dir_all(path.parent().unwrap())
                .map_err(|e| Error::PlatformFailure(Box::new(e)))?;
            fs::write(&path, secret).map_err(|e| Error::PlatformFailure(Box::new(e)))
        }

        fn get_secret(&self) -> Result<Vec<u8>> {
            let path = credential_path(&self.base, &self.service, &self.user);
            match fs::read(&path) {
                Ok(bytes) => Ok(bytes),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(Error::NoEntry),
                Err(e) => Err(Error::PlatformFailure(Box::new(e))),
            }
        }

        fn delete_credential(&self) -> Result<()> {
            let path = credential_path(&self.base, &self.service, &self.user);
            match fs::remove_file(&path) {
                Ok(()) => Ok(()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(Error::NoEntry),
                Err(e) => Err(Error::PlatformFailure(Box::new(e))),
            }
        }

        fn get_credential(&self) -> Result<Option<Arc<Credential>>> {
            Ok(None)
        }

        fn get_specifiers(&self) -> Option<(String, String)> {
            Some((self.service.clone(), self.user.clone()))
        }

        fn as_any(&self) -> &dyn Any {
            self
        }
    }

    #[derive(Debug)]
    pub struct FileStore {
        base: PathBuf,
    }

    impl CredentialStoreApi for FileStore {
        fn vendor(&self) -> String {
            "open-grind file store".to_string()
        }

        fn id(&self) -> String {
            "file-store-v1".to_string()
        }

        fn build(
            &self,
            service: &str,
            user: &str,
            _modifiers: Option<&HashMap<&str, &str>>,
        ) -> Result<Entry> {
            let cred = Arc::new(FileCredential {
                service: service.to_string(),
                user: user.to_string(),
                base: self.base.clone(),
            }) as Arc<Credential>;
            Ok(Entry::new_with_credential(cred))
        }

        fn persistence(&self) -> CredentialPersistence {
            CredentialPersistence::UntilDelete
        }

        fn as_any(&self) -> &dyn Any {
            self
        }
    }

    pub fn init(base: PathBuf) {
        let store = Arc::new(FileStore { base }) as Arc<CredentialStore>;
        keyring_core::set_default_store(store);
    }
}

#[cfg(all(target_os = "macos", not(feature = "keychain")))]
pub fn init_file_store(base: std::path::PathBuf) {
    file_store::init(base);
}

pub fn init_keyring() {
    #[cfg(target_os = "ios")]
    {
        let store = apple_native_keyring_store::protected::Store::new()
            .expect("failed to init iOS keyring");
        keyring_core::set_default_store(store);
    }

    #[cfg(target_os = "android")]
    {
        let store =
            android_native_keyring_store::Store::new().expect("failed to init Android keyring");
        keyring_core::set_default_store(store);
    }

    #[cfg(all(target_os = "macos", feature = "keychain"))]
    {
        let store = apple_native_keyring_store::keychain::Store::new()
            .expect("failed to init macOS keyring");
        keyring_core::set_default_store(store);
    }

    #[cfg(target_os = "windows")]
    {
        let store =
            windows_native_keyring_store::Store::new().expect("failed to init Windows keyring");
        keyring_core::set_default_store(store);
    }

    #[cfg(target_os = "linux")]
    {
        let store =
            linux_keyutils_keyring_store::Store::new().expect("failed to init Linux keyring");
        keyring_core::set_default_store(store);
    }
}
