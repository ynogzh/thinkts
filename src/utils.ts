export function toPascalCase(str: string): string {
  return str.replace(/(?:^|[-_])([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

export function toKebabCase(str: string): string {
  return str.replace(/([A-Z])/g, "-$1").toLowerCase().replace(/^-/, "");
}
