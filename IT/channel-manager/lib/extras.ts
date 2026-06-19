export type ExtraDef = {
  id: string;
  label: string;
  /** Cleaner task template — use {room} placeholder. Null = no cleaner action. */
  cleanerTask: string | null;
};

export const EXTRAS: ExtraDef[] = [
  { id: 'parking',             label: 'Parking',             cleanerTask: null },
  { id: 'vented-ac',           label: 'Vented Aircon',       cleanerTask: 'Set up vented aircon in {room}' },
  { id: 'aircon',              label: 'Vented Aircon (portal)', cleanerTask: 'Set up vented aircon in {room}' },
  { id: 'cooking-pack',        label: 'Cooking Pack',        cleanerTask: null },
  { id: 'extra-guest-double',  label: 'Blow-up Double Bed',  cleanerTask: 'Set up blow-up double mattress with bedding in {room}' },
  { id: 'extra-guest-single',  label: 'Blow-up Single Bed',  cleanerTask: 'Set up blow-up single mattress with bedding in {room}' },
];

export const EXTRA_CAPACITY: Record<string, number> = {
  'parking':            1,
  'vented-ac':          2,
  'aircon':             2,
  'cooking-pack':       5,
  'extra-guest-double': 2,
  'extra-guest-single': 2,
};

export function getExtra(id: string): ExtraDef | undefined {
  return EXTRAS.find((e) => e.id === id);
}
