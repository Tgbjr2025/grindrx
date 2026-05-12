console.error(
	"\x1b[31merror\x1b[0m: Use \x1b[1mbun run test\x1b[0m instead of \x1b[1mbun test\x1b[0m.",
);
console.error(
	"       This project uses Vitest, not Bun's built-in test runner.",
);
process.exit(1);
