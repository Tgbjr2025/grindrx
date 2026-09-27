# Third-party notices

GrindrX itself is MIT — see [LICENSE](./LICENSE), which is the upstream Open Grind
licence, inherited unchanged by this fork.

This file reproduces the licence text and copyright lines of the third-party
components whose code or **stylesheet** is redistributed inside the published
APK. Every text below was copied verbatim from the installed package's own
`LICENSE*` file in `node_modules/`, not from a website.

**Why this file exists.** The bundler strips per-file licence headers, so the
notices in `node_modules/*/LICENSE` never reach a user who installs the APK.
The BSD-2-Clause licence of Leaflet requires, in clause 2, that redistributions
in binary form reproduce the copyright notice, conditions and disclaimer in the
documentation or other materials provided with the distribution — Leaflet's
stylesheet (`import "leaflet/dist/leaflet.css"` in the map page) is bundled into
the APK with its header stripped, so this document is that reproduction.
`shadcn-svelte`'s `src/lib/components/ui/**` are vendored copies of upstream
shadcn-svelte components; the MIT notice is retained here because the vendored
files carry no header of their own.

---

## Full licence texts

### leaflet 1.9.4 — BSD 2-Clause

Bundled: `leaflet/dist/leaflet.css` (stylesheet) and the Leaflet runtime, via
`src/routes/(protected)/(navbar)/map/+page.svelte` and
`src/lib/components/location-chooser/GeoMapPicker.svelte`.

```
BSD 2-Clause License

Copyright (c) 2010-2023, Volodymyr Agafonkin
Copyright (c) 2010-2011, CloudMade
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### sveaflet 0.1.4 — MIT

```
MIT License

Copyright (c) 2024 Gary

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### bits-ui 2.18.1 — MIT

```
MIT License

Copyright (c) 2023 Hunter Johnston

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### shadcn-svelte 1.2.7 — MIT

The `src/lib/components/ui/**` tree (139 `.svelte` files across 30 component
directories) is vendored from this project.

```
MIT License

Copyright (c) 2023 Hunter Johnston <https://github.com/huntabyte>
Copyright (c) 2023 CokaKoala <https://github.com/adriangonz97>
Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### photoswipe 5.4.4 — MIT

Bundled stylesheet `photoswipe/style.css`, imported in four components
(`MediaGallery.svelte`, `ImageMessage.svelte`, `AlbumMessage.svelte`,
`ImageCarousel.svelte`).

```
The MIT License (MIT)

Copyright (c) 2014-2022 Dmitry Semenov, https://dimsemenov.com

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### paneforge 1.0.2 — MIT

```
MIT License

Copyright (c) 2024 Hunter Johnston <https://github.com/huntabyte>
Copyright (c) 2023 Brian Vaughn <https://github.com/bvaughn>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### date-fns 4.1.0 — MIT

```
MIT License

Copyright (c) 2021 Sasha Koss and Lesha Koss https://kossnocorp.mit-license.org

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Other direct runtime dependencies

These are also bundled into the APK and are all MIT — except `@msgpack/msgpack`,
whose LICENSE is the short ISC-style MessagePack Community notice reproduced
below, and the font, which is OFL. The `@tauri-apps/*` packages carry
`SPDX-License-Identifier: MIT OR Apache-2.0`; the MIT text is the one reproduced
above, and the Apache-2.0 text is at
<https://www.apache.org/licenses/LICENSE-2.0>.

| Package                                                                                          | Version        | Licence                                  | Bundled for                                   |
| ------------------------------------------------------------------------------------------------ | -------------- | ---------------------------------------- | --------------------------------------------- |
| `@floating-ui/dom`                                                                               | see `bun.lock` | MIT                                      | popover/positioning primitives                |
| `@msgpack/msgpack`                                                                               | see `bun.lock` | MessagePack Community notice (ISC-style) | wire codec                                    |
| `@tailwindcss/vite`, `tailwindcss`, `tw-animate-css`                                             | see `bun.lock` | MIT                                      | styling; `tw-animate-css` ships the keyframes |
| `@tauri-apps/api`                                                                                | see `bun.lock` | MIT OR Apache-2.0                        | Tauri IPC surface                             |
| `@tauri-apps/plugin-*` (biometric, clipboard-manager, fs, geolocation, notification, opener, os) | see `bun.lock` | MIT OR Apache-2.0                        | native capabilities                           |
| `@fontsource-variable/ibm-plex-sans`                                                             | see `bun.lock` | SIL OFL 1.1                              | the app typeface                              |
| `clsx`                                                                                           | see `bun.lock` | MIT                                      | class-name helper                             |
| `lodash-es`                                                                                      | see `bun.lock` | MIT                                      | collection helpers                            |
| `phosphor-svelte`                                                                                | see `bun.lock` | MIT                                      | icon set                                      |
| `svelte-sonner`                                                                                  | see `bun.lock` | MIT                                      | toasts                                        |
| `tailwind-merge`, `tailwind-variants`                                                            | see `bun.lock` | MIT                                      | Tailwind class merging                        |
| `vaul-svelte`                                                                                    | see `bun.lock` | MIT                                      | drawer / bottom-sheet primitive               |
| `zod`                                                                                            | see `bun.lock` | MIT                                      | runtime validation                            |

### @msgpack/msgpack — MessagePack Community notice

```
Copyright 2019 The MessagePack Community.

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```

Two things deliberately **not** claimed here:

- The **Rust** dependency tree (`src-tauri/Cargo.lock`) — tauri, wry, reqwest,
  tokio, rmp-serde, keyring-_, etc. — is a much larger set with its own licence
  inventory. Most are MIT/Apache-2.0 dual, but some are not (ring is ISC/Apache,
  `windows-_`crates are MIT/Apache,`webpki-roots`is MPL-2.0). Producing that
inventory needs`cargo license`/`cargo-about` on a machine with the crate
  sources. **Not done.** See "Outstanding" below.
- The **transitive** JS tree under `node_modules/` beyond the direct
  dependencies listed here.

## Outstanding

`cargo deny` / `cargo-license` has never been run against `src-tauri/Cargo.toml`.
Before the next release this file should be regenerated with a tool that walks
`Cargo.lock`, so the native side of the APK is covered too.

## SPDX identifiers in source

There are **no** per-file SPDX headers or licence banners in `src/` or
`src-tauri/src/`. Adding one to every file is a large, noisy diff that touches
files owned by other batches, and the root `LICENSE` already covers the
project's own code. If the operator wants per-file SPDX, it is best done as its
own pass — the tooling (`reuse lint`, or adding `# SPDX-License-Identifier: MIT`
enforced by a pre-commit hook) is the thing to decide first.
