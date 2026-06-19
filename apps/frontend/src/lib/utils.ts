type PrimitiveClassValue = string | number | boolean | null | undefined
type ClassDictionary = Record<string, boolean | null | undefined>
type ClassArray = ClassValue[]
type ClassValue = PrimitiveClassValue | ClassDictionary | ClassArray

function normalizeClassValue(value: ClassValue): string[] {
  if (!value) return []

  if (typeof value === 'string' || typeof value === 'number') {
    return [String(value)]
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeClassValue(item))
  }

  if (typeof value === 'object') {
    return Object.entries(value)
      .filter(([, enabled]) => Boolean(enabled))
      .map(([className]) => className)
  }

  return []
}

export function cn(...classes: ClassValue[]): string {
  return classes.flatMap((classValue) => normalizeClassValue(classValue)).join(' ')
}
