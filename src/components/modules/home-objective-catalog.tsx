import { HomeObjectives } from "./home-objectives";

export function HomeObjectiveCatalog(props: Parameters<typeof HomeObjectives>[0]) {
  return <HomeObjectives {...props} />;
}
