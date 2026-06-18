export type ExtraDef = {
  id: string;
  label: string;
  /** Cleaner task template — use {room} placeholder. Null = no cleaner action. */
  cleanerTask: string | null;
};

export const EXTRAS: ExtraDef[] = [
  { id: 'parking',      label: 'Parking',       cleanerTask: null },
  { id: 'vented-ac',    label: 'Vented Aircon',  cleanerTask: 'Set up vented aircon in {room}' },
  { id: 'cooking-pack', label: 'Cooking Pack',   cleanerTask: null },
];

export const EXTRA_CAPACITY: Record<string, number> = {
  'parking':      1,
  'vented-ac':    2,
  'cooking-pack': 5,
};

export function getExtra(id: string): ExtraDef | undefined {
  return EXTRAS.find((e) => e.id === id);
}
