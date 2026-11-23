import {expect,it,vi} from "vitest";
import {writeActiveDraft} from "./draft-cache";
it("retains the previous identity before switching to another local analysis",()=>{
  const old={draft:{evidenceId:"old"},step:6}, next={draft:{evidenceId:"new"},step:0};
  const active={read:()=>old,write:vi.fn(()=>true)}, others={read:()=>null,write:vi.fn(()=>true)};
  expect(writeActiveDraft(next,active,others)).toBe(true);
  expect(others.write).toHaveBeenCalledWith({old});expect(active.write).toHaveBeenCalledWith(next);
  others.write.mockReturnValue(false);active.write.mockClear();
  expect(writeActiveDraft(next,active,others)).toBe(false);expect(active.write).not.toHaveBeenCalled();
});
