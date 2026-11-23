// A previous local draft must remain recoverable when another file takes focus.
export function writeActiveDraft<T extends {draft:{evidenceId?:string}}>(
  value:T, active:{read():T|null;write(v:T):boolean}, others:{read():Record<string,T>|null;write(v:Record<string,T>):boolean},
) {
  const previous = active.read();
  const id = previous?.draft.evidenceId;
  if (previous && id && id !== value.draft.evidenceId && !others.write({...others.read(),[id]:previous})) return false;
  return active.write(value);
}
