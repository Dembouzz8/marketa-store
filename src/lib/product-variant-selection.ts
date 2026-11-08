import type {
  PublicProductVariantCombination,
  PublicProductVariantProjection,
} from "@/types"

export type VariantSelectionState = Record<string, string>

function valueForAxis(
  combination: PublicProductVariantCombination,
  axisId: string
): string | null {
  return (
    combination.selections.find((selection) => selection.axis_id === axisId)
      ?.value_id ?? null
  )
}

function matchesEarlierSelections(
  combination: PublicProductVariantCombination,
  projection: PublicProductVariantProjection,
  selections: VariantSelectionState,
  axisId: string
): boolean {
  const targetAxis = projection.axes.find((axis) => axis.id === axisId)
  if (!targetAxis) return false

  return projection.axes.every(
    (axis) =>
      axis.position >= targetAxis.position ||
      selections[axis.id] === undefined ||
      valueForAxis(combination, axis.id) === selections[axis.id]
  )
}

export function getSelectableVariantValueIds(
  projection: PublicProductVariantProjection,
  selections: VariantSelectionState,
  axisId: string
): Set<string> {
  const selectable = new Set<string>()

  for (const combination of projection.combinations) {
    if (
      combination.stock <= 0 ||
      !matchesEarlierSelections(combination, projection, selections, axisId)
    ) {
      continue
    }

    const valueId = valueForAxis(combination, axisId)
    if (valueId) selectable.add(valueId)
  }

  return selectable
}

export function reconcileVariantSelection(
  projection: PublicProductVariantProjection,
  selections: VariantSelectionState,
  changedAxisId: string,
  changedValueId: string
): VariantSelectionState {
  const selectableValues = getSelectableVariantValueIds(
    projection,
    selections,
    changedAxisId
  )
  if (!selectableValues.has(changedValueId)) return selections

  let candidates = projection.combinations.filter(
    (combination) =>
      combination.stock > 0 &&
      valueForAxis(combination, changedAxisId) === changedValueId &&
      matchesEarlierSelections(
        combination,
        projection,
        selections,
        changedAxisId
      )
  )

  const next: VariantSelectionState = { [changedAxisId]: changedValueId }

  for (const axis of projection.axes) {
    if (axis.id === changedAxisId) continue
    const selectedValueId = selections[axis.id]
    if (!selectedValueId) continue

    const compatible = candidates.filter(
      (combination) => valueForAxis(combination, axis.id) === selectedValueId
    )
    if (compatible.length > 0) {
      next[axis.id] = selectedValueId
      candidates = compatible
    }
  }

  return next
}

export function resolveSelectedVariant(
  projection: PublicProductVariantProjection,
  selections: VariantSelectionState
): PublicProductVariantCombination | null {
  const selectedAxisIds = Object.keys(selections)
  if (
    selectedAxisIds.length !== projection.axes.length ||
    projection.axes.some((axis) => typeof selections[axis.id] !== "string") ||
    selectedAxisIds.some(
      (axisId) => !projection.axes.some((axis) => axis.id === axisId)
    )
  ) {
    return null
  }

  return (
    projection.combinations.find(
      (combination) =>
        combination.stock > 0 &&
        projection.axes.every(
          (axis) => valueForAxis(combination, axis.id) === selections[axis.id]
        )
    ) ?? null
  )
}
