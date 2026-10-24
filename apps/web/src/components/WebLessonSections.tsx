import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { communityLessonSectionTexts } from "../../../../shared/communityLessonSections";

// A long lesson on one page, in its sections (shared/communityLessonSections.ts):
// a small section list that follows the reader, and a way back to the section
// they last reached. Where they got to is kept on this device.

const positionKey = (resourceId: string) => `polynet:lesson-section:${resourceId}`;

function readPosition(resourceId: string): string | null {
  try {
    return window.localStorage.getItem(positionKey(resourceId));
  } catch {
    return null;
  }
}

function writePosition(resourceId: string, sectionId: string) {
  try {
    window.localStorage.setItem(positionKey(resourceId), sectionId);
  } catch {
    // Private windows and blocked storage: the lesson still reads, it just won't resume.
  }
}

export function lessonHasSections(bodyMd: string): boolean {
  return communityLessonSectionTexts(bodyMd).filter((section) => section.heading).length >= 2;
}

export function WebLessonSections(props: {
  resourceId: string;
  bodyMd: string;
  renderSection: (text: string) => ReactNode;
}) {
  const sections = useMemo(() => communityLessonSectionTexts(props.bodyMd), [props.bodyMd]);
  const [current, setCurrent] = useState(0);
  const [open, setOpen] = useState(false);
  const [resumeId, setResumeId] = useState<string | null>(null);
  const refs = useRef<Array<HTMLElement | null>>([]);
  const furthest = useRef(0);

  useEffect(() => {
    const stored = readPosition(props.resourceId);
    const index = sections.findIndex((section) => section.id === stored);
    furthest.current = Math.max(0, index);
    setResumeId(index > 0 ? stored : null);
  }, [props.resourceId, sections]);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const index = Number((entry.target as HTMLElement).dataset.lessonSectionIndex);
        setCurrent(index);
        if (index > furthest.current) {
          furthest.current = index;
          writePosition(props.resourceId, sections[index].id);
        }
      }
    }, { rootMargin: "0px 0px -70% 0px" });
    for (const element of refs.current) if (element) observer.observe(element);
    return () => observer.disconnect();
  }, [props.resourceId, sections]);

  const goTo = (index: number) => {
    setOpen(false);
    setResumeId(null);
    refs.current[index]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const label = (index: number) => sections[index]?.heading ?? "Start";
  const resumeIndex = resumeId ? sections.findIndex((section) => section.id === resumeId) : -1;

  return (
    <>
      <nav className="lesson-sections" aria-label="Lesson sections">
        <button className="lesson-sections-toggle" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="lesson-sections-count">{current + 1} of {sections.length}</span>
          <span className="lesson-sections-current">{label(current)}</span>
        </button>
        <div className="lesson-sections-bar" aria-hidden="true">
          <span style={{ width: `${((current + 1) / sections.length) * 100}%` }} />
        </div>
        {open ? (
          <ol className="lesson-sections-list">
            {sections.map((section, index) => (
              <li key={section.id}>
                <button type="button" aria-current={index === current ? "true" : undefined} onClick={() => goTo(index)}>
                  {label(index)}
                </button>
              </li>
            ))}
          </ol>
        ) : null}
      </nav>
      {resumeIndex > 0 ? (
        <button className="lesson-sections-resume" type="button" onClick={() => goTo(resumeIndex)}>
          Pick up where you left off: {label(resumeIndex)}
        </button>
      ) : null}
      {sections.map((section, index) => (
        <section
          key={section.id}
          id={`lesson-section-${section.id}`}
          className="lesson-section"
          data-lesson-section-index={index}
          ref={(element) => { refs.current[index] = element; }}
        >
          {props.renderSection(section.text)}
        </section>
      ))}
    </>
  );
}
