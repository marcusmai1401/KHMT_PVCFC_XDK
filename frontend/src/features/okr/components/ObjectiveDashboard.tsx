import type { ObjectiveSectionPayload } from "../types/dashboard";
import { ObjectiveSection } from "./ObjectiveSection";

const fallbackSections: ObjectiveSectionPayload[] = ["O1", "O2", "O3", "O4", "O5", "O6"].map((code) => ({
  objective_code: code,
  title: "",
  status: "no_data",
  conclusion: null,
  visuals: [],
  notes: [],
  source_references: [],
}));

export function ObjectiveDashboard({
  sections,
  onDrillDown,
}: {
  sections?: ObjectiveSectionPayload[];
  onDrillDown?: (objectiveCode: string) => void;
}) {
  const renderedSections = sections?.length ? sections : fallbackSections;
  return (
    <section className="objective-dashboard" aria-label="Dashboard theo mục tiêu">
      {renderedSections.map((section, index) => (
        <ObjectiveSection
          key={`${section.objective_code || "objective"}-${index}`}
          onDrillDown={onDrillDown}
          section={section}
        />
      ))}
    </section>
  );
}
