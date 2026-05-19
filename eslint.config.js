import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import perfectionist from "eslint-plugin-perfectionist";
import svelte from "eslint-plugin-svelte";
import { defineConfig } from "eslint/config";
import globals from "globals";
import ts from "typescript-eslint";

import svelteConfig from "./svelte.config.js";

export default defineConfig(
	js.configs.recommended,
	...ts.configs.recommendedTypeChecked,
	prettier,
	svelte.configs.prettier,
	{
		plugins: {
			perfectionist,
		},
		languageOptions: {
			globals: globals.node,
			parserOptions: {
				projectService: true,
			},
		},
		rules: {
			"no-undef": "off",
			"@typescript-eslint/require-array-sort-compare": [
				"error",
				{ ignoreStringArrays: true },
			],
			"perfectionist/sort-imports": [
				"error",
				{
					internalPattern: ["^\\$lib/"],
					newlinesBetween: 0,
					groups: [
						["value-external", "value-builtin"],
						["type-external", "type-builtin"],
						{ newlinesBetween: 1 },
						"value-internal",
						"type-internal",
						[
							"value-parent",
							"value-sibling",
							"value-index",
							"type-parent",
							"type-sibling",
							"type-index",
						],
						"ts-equals-import",
						"unknown",
					],
				},
			],
			"perfectionist/sort-named-imports": "error",
		},
	},
	{
		files: ["**/*.svelte", "**/*.svelte.ts", "**/*.svelte.js"],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: [".svelte"],
				parser: ts.parser,
				svelteConfig,
			},
		},
		rules: {
			"@typescript-eslint/require-array-sort-compare": [
				"error",
				{ ignoreStringArrays: true },
			],
		},
	},
	{
		files: ["**/*.config.{js,ts,mjs,cjs}", "*.config.{js,ts,mjs,cjs}"],
		...ts.configs.disableTypeChecked,
	},
);
