import { describe, expect, it, beforeEach } from "vitest";
import { repairCollapsedShapes } from "../src/pptx/thinShapes";

/**
 * jsdom does not lay out, so getBoundingClientRect returns zeroes. Stub it
 * from each element's inline width/height, which is what the renderer sets
 * and what the real code reads.
 */
function layOut(root: HTMLElement): void {
	for (const svg of Array.from(root.querySelectorAll("svg"))) {
		const el = svg as SVGElement & { getBoundingClientRect: () => DOMRect };
		el.getBoundingClientRect = () =>
			({
				width: Number.parseFloat(el.style.width || "0"),
				height: Number.parseFloat(el.style.height || "0"),
			}) as DOMRect;
	}
}

function slide(html: string): HTMLElement {
	const host = document.createElement("div");
	host.innerHTML = html;
	layOut(host);
	return host;
}

const CONNECTOR = (style: string) =>
	`<svg viewBox="0 0 100 100" style="${style}">
		<polygon points="0,0 100,0 100,100 0,100" stroke-width="2.6666" />
	</svg>`;

describe("repairCollapsedShapes", () => {
	it("gives a flat horizontal connector the thickness of its stroke", () => {
		const host = slide(CONNECTOR("position:absolute; left:384px; top:240px; width:105.6px; height:0px;"));

		expect(repairCollapsedShapes(host)).toBe(1);

		const svg = host.querySelector("svg")!;
		expect(Number.parseFloat(svg.style.height)).toBeCloseTo(2.6666, 3);
		// Pulled back half a stroke so it stays centred on the original axis.
		expect(Number.parseFloat(svg.style.top)).toBeCloseTo(240 - 2.6666 / 2, 3);
	});

	it("stretches the viewBox, or the polygon would scale down to a dot", () => {
		const host = slide(CONNECTOR("position:absolute; top:240px; width:105.6px; height:0px;"));
		repairCollapsedShapes(host);
		expect(host.querySelector("svg")!.getAttribute("preserveAspectRatio")).toBe("none");
	});

	it("handles a flat vertical connector on the other axis", () => {
		const host = slide(CONNECTOR("position:absolute; left:100px; top:50px; width:0px; height:80px;"));

		expect(repairCollapsedShapes(host)).toBe(1);

		const svg = host.querySelector("svg")!;
		expect(Number.parseFloat(svg.style.width)).toBeCloseTo(2.6666, 3);
		expect(Number.parseFloat(svg.style.left)).toBeCloseTo(100 - 2.6666 / 2, 3);
		expect(svg.style.height).toBe("80px");
	});

	it("leaves a shape that already has both dimensions alone", () => {
		const host = slide(CONNECTOR("position:absolute; left:10px; top:10px; width:50px; height:40px;"));

		expect(repairCollapsedShapes(host)).toBe(0);
		expect(host.querySelector("svg")!.getAttribute("preserveAspectRatio")).toBeNull();
	});

	it("ignores a shape collapsed on both axes, which has no direction to grow", () => {
		const host = slide(CONNECTOR("position:absolute; left:10px; top:10px; width:0px; height:0px;"));
		expect(repairCollapsedShapes(host)).toBe(0);
	});

	it("falls back to a 1px stroke when the shape declares none", () => {
		const host = slide(
			`<svg viewBox="0 0 100 100" style="position:absolute; top:10px; width:60px; height:0px;">
				<polygon points="0,0 100,0" />
			</svg>`
		);

		expect(repairCollapsedShapes(host)).toBe(1);
		expect(host.querySelector("svg")!.style.height).toBe("1px");
	});

	it("repairs every connector on a slide, not just the first", () => {
		const host = slide(
			CONNECTOR("position:absolute; top:240px; width:105.6px; height:0px;") +
				CONNECTOR("position:absolute; top:240px; width:100.8px; height:0px;")
		);
		expect(repairCollapsedShapes(host)).toBe(2);
	});
});
