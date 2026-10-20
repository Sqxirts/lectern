const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const STEP = 0.1;

/**
 * Zoom is a CSS transform on the content, which is cheap and keeps text crisp.
 *
 * A transform does not change layout size, so on its own it would leave the
 * scrollbars sized for the unzoomed content and the bottom of a zoomed-in page
 * unreachable. The sizer element exists only to hold the scaled dimensions and
 * give the scroll container something real to measure.
 */
export class ZoomController {
	private wrapper: HTMLElement;
	private sizer: HTMLElement;
	private content: HTMLElement;
	private indicator: HTMLElement;
	private onChange: () => void;

	private level = 1;
	private natural = { width: 0, height: 0 };
	private panning = false;
	private panStart = { x: 0, y: 0, left: 0, top: 0 };

	constructor(
		wrapper: HTMLElement,
		sizer: HTMLElement,
		content: HTMLElement,
		indicator: HTMLElement,
		onChange: () => void
	) {
		this.wrapper = wrapper;
		this.sizer = sizer;
		this.content = content;
		this.indicator = indicator;
		this.onChange = onChange;

		this.wrapper.addEventListener("wheel", this.onWheel, { passive: false });
		this.wrapper.addEventListener("pointerdown", this.onPointerDown);
		this.wrapper.addEventListener("pointermove", this.onPointerMove);
		this.wrapper.addEventListener("pointerup", this.onPointerUp);
		this.wrapper.addEventListener("pointercancel", this.onPointerUp);
	}

	/** Record the unzoomed size. Call after the content is in the DOM. */
	measure(): void {
		// The content has `min-width: 100%` of the sizer, and the sizer is set
		// to natural size x zoom. Measuring with the zoomed sizer in place read
		// the zoomed width back as "natural", so every zoom step fed the next:
		// the ResizeObserver re-measured, the sizer grew again, and the slides
		// drifted off screen after one click of +. Reset and Fit then did their
		// maths on the inflated width. Take the sizer's size out first, so the
		// content measures against the pane alone. All synchronous: no paint
		// happens in between.
		const previous = this.content.style.transform;
		const sizerWidth = this.sizer.style.width;
		const sizerHeight = this.sizer.style.height;
		this.content.style.transform = "none";
		this.sizer.style.width = "";
		this.sizer.style.height = "";
		this.natural = {
			width: this.content.scrollWidth,
			height: this.content.scrollHeight,
		};
		this.sizer.style.width = sizerWidth;
		this.sizer.style.height = sizerHeight;
		this.content.style.transform = previous;
		this.apply();
	}

	get value(): number {
		return this.level;
	}

	/**
	 * Zoom so the point under `anchor` (client coordinates) stays where it is.
	 * Defaults to the middle of the pane, which is what a zoom button should
	 * do; the wheel passes the cursor. Without this every zoom grew from the
	 * top-left corner and the part you were reading slid away.
	 */
	set(level: number, anchor?: { x: number; y: number }): void {
		const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, level));
		// The pane's right padding is the comment rail's, so the middle of the
		// usable area, not of the whole pane, is where the slide sits.
		const view = this.wrapper.getBoundingClientRect();
		const style = getComputedStyle(this.wrapper);
		const left = view.left + parseFloat(style.paddingLeft || "0");
		const right = view.right - parseFloat(style.paddingRight || "0");
		const at = anchor ?? { x: (left + right) / 2, y: view.top + view.height / 2 };

		// Where the anchor falls in unzoomed content coordinates.
		const before = this.sizer.getBoundingClientRect();
		const px = (at.x - before.left) / this.level;
		const py = (at.y - before.top) / this.level;

		this.level = next;
		this.apply();

		// Scroll so that same content point lands back under the anchor. Read
		// the rect again: centring margins move the sizer as it resizes.
		const after = this.sizer.getBoundingClientRect();
		this.wrapper.scrollLeft += after.left + px * next - at.x;
		this.wrapper.scrollTop += after.top + py * next - at.y;

		this.onChange();
	}

	in(): void {
		this.set(this.level + STEP);
	}

	out(): void {
		this.set(this.level - STEP);
	}

	reset(): void {
		this.set(1);
	}

	/**
	 * The zoom at which the content's natural width fills the visible area.
	 *
	 * The wrapper's right padding is reserved for the comment rail, so the
	 * usable width is its client width minus its own horizontal padding.
	 * Returns 1 before measure() has run, or if the content already fits.
	 */
	fitLevel(): number {
		if (this.natural.width <= 0) return 1;

		const style = getComputedStyle(this.wrapper);
		const padding = parseFloat(style.paddingLeft || "0") + parseFloat(style.paddingRight || "0");
		const usable = this.wrapper.clientWidth - padding;
		if (usable <= 0) return 1;

		return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, usable / this.natural.width));
	}

	/** Scale so the content's full width is visible without sideways scrolling. */
	fitToWidth(): void {
		this.set(this.fitLevel());
	}

	/** True when the content is wider than the space available for it. */
	get overflowsWidth(): boolean {
		return this.fitLevel() < 1;
	}

	private apply(): void {
		this.content.style.transform = `scale(${this.level})`;
		if (this.natural.width > 0) {
			this.sizer.style.width = `${this.natural.width * this.level}px`;
			this.sizer.style.height = `${this.natural.height * this.level}px`;
		}
		this.indicator.setText(`${Math.round(this.level * 100)}%`);
	}

	private onWheel = (event: WheelEvent): void => {
		if (!event.ctrlKey && !event.metaKey) return;
		event.preventDefault();
		this.set(this.level + (event.deltaY < 0 ? STEP : -STEP), { x: event.clientX, y: event.clientY });
	};

	// Middle-drag pans. Left-drag has to stay free for selecting text, which is
	// the whole point of rendering slides as HTML.
	private onPointerDown = (event: PointerEvent): void => {
		if (event.button !== 1) return;
		event.preventDefault();
		this.panning = true;
		this.panStart = {
			x: event.clientX,
			y: event.clientY,
			left: this.wrapper.scrollLeft,
			top: this.wrapper.scrollTop,
		};
		this.wrapper.addClass("is-panning");
		this.wrapper.setPointerCapture(event.pointerId);
	};

	private onPointerMove = (event: PointerEvent): void => {
		if (!this.panning) return;
		this.wrapper.scrollLeft = this.panStart.left - (event.clientX - this.panStart.x);
		this.wrapper.scrollTop = this.panStart.top - (event.clientY - this.panStart.y);
	};

	private onPointerUp = (event: PointerEvent): void => {
		if (!this.panning) return;
		this.panning = false;
		this.wrapper.removeClass("is-panning");
		if (this.wrapper.hasPointerCapture(event.pointerId)) {
			this.wrapper.releasePointerCapture(event.pointerId);
		}
	};

	destroy(): void {
		this.wrapper.removeEventListener("wheel", this.onWheel);
		this.wrapper.removeEventListener("pointerdown", this.onPointerDown);
		this.wrapper.removeEventListener("pointermove", this.onPointerMove);
		this.wrapper.removeEventListener("pointerup", this.onPointerUp);
		this.wrapper.removeEventListener("pointercancel", this.onPointerUp);
	}
}
