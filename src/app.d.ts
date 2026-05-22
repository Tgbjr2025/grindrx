// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Error {
			message: string;
		}
		// interface Locals {}
		interface PageData {
			ourProfileId?: number;
		}
		// interface PageState {}
		// interface Platform {}
	}
	interface Window {
		__reapplyInsets: () => unknown;
		__AndroidInsets?: {
			top(): number;
			bottom(): number;
			left(): number;
			right(): number;
		};
		__AndroidOnBackGesture?: () => boolean;
	}
}

export {};
