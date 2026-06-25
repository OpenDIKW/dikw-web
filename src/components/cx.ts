/**
 * Join truthy class-name parts with a single space. Lets a shared component
 * append a call-site's extra classes (`cx("icon-button", props.className)`)
 * instead of replacing them.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
