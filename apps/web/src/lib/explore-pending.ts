import {
  CHAMBERS,
  type ExploreState,
  PAGE_SIZES,
  parseAsDistrict,
  parseAsSort,
  scopeOf,
} from './explore-params';

export type ExplorePatch = Partial<
  Pick<ExploreState, 'q' | 'scope' | 'chamber' | 'state' | 'district' | 'party' | 'sort' | 'size'>
>;

/** What the server drew in a select for `wanted`: that option, or the first one if absent. */
function drawnSelectValue(select: HTMLSelectElement, wanted: string): string {
  const options = [...select.options];
  return options.some((o) => o.value === wanted) ? wanted : (options[0]?.value ?? '');
}

function changedSelect(form: HTMLFormElement, name: string, wanted: string): string | null {
  const field = form.elements.namedItem(name);
  if (!(field instanceof HTMLSelectElement)) return null;
  return field.value === drawnSelectValue(field, wanted) ? null : field.value;
}

/** The checked radio's value if it is not the one the server drew checked. */
function changedRadio(form: HTMLFormElement, name: string, wanted: string): string | null {
  const radios = [
    ...form.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${name}"]`),
  ];
  const checked = radios.find((r) => r.checked);
  if (!checked) return null;
  const drawn = radios.some((r) => r.value === wanted) ? wanted : null;
  return checked.value === drawn ? null : checked.value;
}

/**
 * Choices made in the server-rendered form before React hydrated: the browser drew them,
 * but no handler ran, so the URL (and the table) never changed. Compares each field with
 * what the server rendered for `state`; returns the URL update that applies them, or null.
 */
export function changesBeforeHydration(
  form: HTMLFormElement,
  state: ExploreState,
): ExplorePatch | null {
  const patch: ExplorePatch = {};

  const q = form.elements.namedItem('q');
  if (q instanceof HTMLInputElement && q.value !== (state.q ?? '')) {
    patch.q = q.value.trim() || null;
  }
  const scope = changedRadio(form, 'scope', scopeOf(state));
  if (scope !== null) patch.scope = scope === 'all' ? 'all' : null;
  const chamber = changedRadio(form, 'chamber', state.chamber ?? '');
  if (chamber !== null) patch.chamber = CHAMBERS.find((c) => c === chamber) ?? null;
  const stateCode = changedSelect(form, 'state', state.state ?? '');
  if (stateCode !== null) {
    patch.state = stateCode || null;
    patch.district = null;
  }
  const district = changedSelect(form, 'district', String(state.district ?? ''));
  if (district !== null && stateCode === null) patch.district = parseAsDistrict.parse(district);
  const party = changedSelect(form, 'party', state.party ?? '');
  if (party !== null) patch.party = party || null;
  const first = state.sort?.[0];
  const sort = changedSelect(form, 'sort', first ? `${first.id}.${first.direction}` : '');
  if (sort !== null) patch.sort = sort ? parseAsSort.parse(sort) : null;
  const size = changedSelect(form, 'size', String(state.size));
  if (size !== null) {
    const parsed = PAGE_SIZES.find((s) => String(s) === size);
    if (parsed) patch.size = parsed;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}
