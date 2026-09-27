import { describe, expect, it } from "vitest";

import {
	formatHeight,
	formatWeight,
	heightFromInput,
	heightToInput,
	heightUnitLabel,
	measurementSystemFor,
	weightFromInput,
	weightToInput,
	weightUnitLabel,
} from "$lib/utils/measurements";

describe("measurementSystemFor", () => {
	it("maps the distance unit onto the measurement system", () => {
		expect(measurementSystemFor("km")).toBe("metric");
		expect(measurementSystemFor("mi")).toBe("imperial");
	});

	it("labels the inputs for each system", () => {
		expect(heightUnitLabel("km")).toBe("cm");
		expect(heightUnitLabel("mi")).toBe("in");
		expect(weightUnitLabel("km")).toBe("kg");
		expect(weightUnitLabel("mi")).toBe("lbs");
	});
});

describe("weightToInput / weightFromInput — precision (D14)", () => {
	it("REGRESSION: opening the edit sheet and saving does not lose precision", () => {
		// The real API value cited in measurements.ts. `Math.round(kg)` turned
		// 86182.65 g into "86", and saving wrote 86000 — a silent rewrite with a
		// "Profile updated" toast.
		const stored = 86182.65;
		const shown = weightToInput(stored, "km");
		expect(shown).toBe(86.2);
		expect(weightFromInput(shown, "km")).toBe(86200);
		// The regression proper: the old rounding lost 182 g.
		expect(stored - weightFromInput(shown, "km")).toBeLessThan(100);
	});

	it("keeps one decimal place", () => {
		expect(weightToInput(86182.65, "km")).toBe(86.2);
		expect(weightToInput(85999, "km")).toBe(86);
		expect(weightToInput(85500, "km")).toBe(85.5);
		expect(weightToInput(85449, "km")).toBe(85.4);
	});

	it("round-trips a realistic set of weights to within 100 g", () => {
		for (const grams of [45500, 70000, 86182.65, 90718.5, 120000, 199999]) {
			const back = weightFromInput(weightToInput(grams, "km"), "km");
			expect(Math.abs(back - grams)).toBeLessThan(100);
		}
	});

	it("round-trips in imperial too", () => {
		// lbs is whole-numbered by the display formatter, so the round-trip is
		// inherently lossy — but only by the ~0.45 kg of one pound, never the
		// multi-kg loss a wrong unit would cause.
		const stored = 86182.65;
		const shown = weightToInput(stored, "mi");
		expect(shown).toBe(190);
		expect(Math.abs(weightFromInput(shown, "mi") - stored)).toBeLessThan(500);
	});
});

describe("weightFromInput", () => {
	it("scales kilograms to grams", () => {
		expect(weightFromInput(86, "km")).toBe(86000);
		expect(weightFromInput(86.2, "km")).toBe(86200);
	});

	it("converts pounds back to grams", () => {
		expect(weightFromInput(190, "mi")).toBe(Math.round((190 / 2.2046226218) * 1000));
	});
});

describe("formatWeight", () => {
	it("formats the raw gram value in the active system", () => {
		expect(formatWeight(86182.65, "km")).toBe("86 kg");
		expect(formatWeight(86182.65, "mi")).toBe("190 lbs");
		expect(formatWeight(0, "km")).toBe("0 kg");
	});
});

describe("heightToInput / heightFromInput", () => {
	it("passes centimetres through unscaled", () => {
		expect(heightToInput(178, "km")).toBe(178);
		expect(heightFromInput(178, "km")).toBe(178);
	});

	it("converts centimetres to whole inches in imperial", () => {
		expect(heightToInput(180, "mi")).toBe(71);
		expect(heightFromInput(71, "mi")).toBe(Math.round(71 * 2.54));
	});

	it("round-trips a height within 1 cm in metric", () => {
		expect(heightFromInput(heightToInput(178, "km"), "km")).toBe(178);
	});
});

describe("formatHeight", () => {
	it("formats feet/inches in imperial and cm in metric", () => {
		expect(formatHeight(180, "mi")).toBe("5'11\"");
		expect(formatHeight(180, "km")).toBe("180 cm");
	});
});
