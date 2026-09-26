import JSZip from "jszip";

/**
 * A minimal but complete .pptx in memory: presentation, one master with a
 * theme, one layout, and the slides given. Enough for the inheritance chain
 * (slide -> layout -> master -> theme) to resolve the way PowerPoint's does.
 */

export const NS = `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;

const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

export const THEME = `<?xml version="1.0"?><a:theme ${NS}><a:themeElements>
	<a:clrScheme name="t">
		<a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
		<a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="EEEEEE"/></a:lt2>
		<a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="90C226"/></a:accent2>
		<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>
		<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>
		<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
	</a:clrScheme>
	<a:fontScheme name="f"><a:majorFont><a:latin typeface="Trebuchet MS"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:fontScheme>
	<a:fmtScheme name="s">
		<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
			<a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="50000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"/></a:gs></a:gsLst><a:lin ang="5400000"/></a:gradFill>
			<a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
		<a:lnStyleLst><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="25400"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
		<a:effectStyleLst/><a:bgFillStyleLst/>
	</a:fmtScheme>
</a:themeElements></a:theme>`;

export interface DeckParts {
	slides: string[];
	/** Inner XML of the master's spTree, after the group properties. */
	masterShapes?: string;
	layoutShapes?: string;
	/** Inner XML of <p:txStyles>. */
	txStyles?: string;
	tableStyles?: string;
	defaultTextStyle?: string;
}

const tree = (inner: string) =>
	`<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${inner}</p:spTree></p:cSld>`;

const rels = (items: [string, string, string][]) =>
	`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items
		.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`)
		.join("")}</Relationships>`;

/** Wrap a slide's shapes in a full <p:sld>. */
export const slide = (shapes: string) => `<?xml version="1.0"?><p:sld ${NS}>${tree(shapes)}</p:sld>`;

export async function buildDeck(parts: DeckParts): Promise<ArrayBuffer> {
	const zip = new JSZip();
	zip.file(
		"ppt/presentation.xml",
		`<?xml version="1.0"?><p:presentation ${NS}><p:sldIdLst>${parts.slides
			.map((_, i) => `<p:sldId id="${256 + i}" r:id="rIdS${i + 1}"/>`)
			.join("")}</p:sldIdLst>${parts.defaultTextStyle ? `<p:defaultTextStyle>${parts.defaultTextStyle}</p:defaultTextStyle>` : ""}</p:presentation>`
	);
	zip.file(
		"ppt/_rels/presentation.xml.rels",
		rels(parts.slides.map((_, i) => [`rIdS${i + 1}`, "slide", `slides/slide${i + 1}.xml`]))
	);
	parts.slides.forEach((xml, i) => {
		zip.file(`ppt/slides/slide${i + 1}.xml`, xml);
		zip.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`, rels([["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"]]));
	});
	zip.file("ppt/slideLayouts/slideLayout1.xml", `<?xml version="1.0"?><p:sldLayout ${NS}>${tree(parts.layoutShapes ?? "")}</p:sldLayout>`);
	zip.file("ppt/slideLayouts/_rels/slideLayout1.xml.rels", rels([["rId1", "slideMaster", "../slideMasters/slideMaster1.xml"]]));
	zip.file(
		"ppt/slideMasters/slideMaster1.xml",
		`<?xml version="1.0"?><p:sldMaster ${NS}>${tree(parts.masterShapes ?? "")}<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:txStyles>${parts.txStyles ?? ""}</p:txStyles></p:sldMaster>`
	);
	zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", rels([["rId1", "theme", "../theme/theme1.xml"]]));
	zip.file("ppt/theme/theme1.xml", THEME);
	if (parts.tableStyles) zip.file("ppt/tableStyles.xml", parts.tableStyles);

	const buf = await zip.generateAsync({ type: "nodebuffer" });
	return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** A text shape with a transform. */
export const textBox = (id: number, body: string, extra = "") =>
	`<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="t${id}"/><p:cNvSpPr/><p:nvPr>${extra}</p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="952500" y="952500"/><a:ext cx="4762500" cy="952500"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${body}</p:txBody></p:sp>`;
