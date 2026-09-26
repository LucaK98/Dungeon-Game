/** Tiny helper to build DOM without a framework. */
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Omit<HTMLElementTagNameMap[K], "style" | "dataset">> & {
    class?: string;
    style?: string;
    dataset?: Record<string, string>;
    attrs?: Record<string, string>;
  } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { class: cls, style, dataset, attrs, ...rest } = props;
  if (cls) el.className = cls;
  if (style) el.setAttribute("style", style);
  if (dataset) Object.assign(el.dataset, dataset);
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  Object.assign(el, rest);
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}
