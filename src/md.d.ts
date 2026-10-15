declare module "*.md" {
	const content: string;
	export default content;
}

declare module "*.png" {
	const dataUrl: string;
	export default dataUrl;
}

declare module "*.svg" {
	const dataUrl: string;
	export default dataUrl;
}
