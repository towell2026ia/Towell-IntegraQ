/** Destination expressly confirmed by Calidad. Never supplied by browser input. */
export const ROOT2CAUSE_REDBOOTH_TARGET = Object.freeze({
  name: "QTW",
  projectId: 2233821,
  listId: 6673813,
  url: "https://redbooth.com/a/#!/projects/2233821/task-lists/6673813",
});
export function assertRootCauseRedboothTarget(projectId:number,listId:number):void {
  if(projectId!==ROOT2CAUSE_REDBOOTH_TARGET.projectId||listId!==ROOT2CAUSE_REDBOOTH_TARGET.listId){
    throw new Error("Root2Cause sólo permite el proyecto QTW (2233821) y la lista 6673813.");
  }
}
