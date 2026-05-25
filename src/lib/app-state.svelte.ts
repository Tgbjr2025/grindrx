export const appState: {
	auth: {
		userId: number;
	} | null;
} = $state({
	auth: null,
});
