/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SubsequenceTriggerEditor } from "../subsequence-trigger-editor";

function renderEditor(
  initial: Partial<{
    trigger_event: string;
    trigger_condition: Record<string, unknown>;
    trigger_priority: number;
    persona: string;
  }> = {},
  onChange = vi.fn()
) {
  render(
    <SubsequenceTriggerEditor
      trigger_event={initial.trigger_event ?? "Reply Classified"}
      trigger_condition={initial.trigger_condition ?? { classification: "INTERESTED" }}
      trigger_priority={initial.trigger_priority ?? 1}
      persona={initial.persona ?? "CFO"}
      onChange={onChange}
    />
  );
  return { onChange };
}

describe("SubsequenceTriggerEditor", () => {
  it("renders days input when initialized with No Reply + days=7", () => {
    renderEditor({ trigger_event: "No Reply", trigger_condition: { days: 7 } });
    const numberInputs = document.querySelectorAll(
      'input[type="number"]'
    ) as NodeListOf<HTMLInputElement>;
    // First number input is the days field (priority is second, after the days block).
    const values = Array.from(numberInputs).map((n) => n.value);
    expect(values).toContain("7");
  });

  it("switches event to Reply Classified → classification select appears + onChange fires full config", () => {
    const { onChange } = renderEditor({
      trigger_event: "No Reply",
      trigger_condition: { days: 7 },
    });

    // Trigger event is the first <select>.
    const eventSelect = document.querySelector("select") as HTMLSelectElement;
    fireEvent.change(eventSelect, { target: { value: "Reply Classified" } });

    // Classification dropdown is now visible with INTERESTED options.
    expect(screen.getByText("INTERESTED")).toBeInTheDocument();

    // onChange fired with full config shape.
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(last).toEqual(
      expect.objectContaining({
        trigger_event: "Reply Classified",
        trigger_condition: { classification: "INTERESTED" },
        trigger_priority: 1,
        persona: "CFO",
      })
    );
  });

  it("editing persona fires onChange with new persona + current trigger shape preserved", () => {
    const { onChange } = renderEditor({
      trigger_event: "Reply Classified",
      trigger_condition: { classification: "OBJECTION" },
      trigger_priority: 2,
      persona: "CFO",
    });

    const textInputs = document.querySelectorAll(
      'input[type="text"]'
    ) as NodeListOf<HTMLInputElement>;
    // Persona is the only text input in the editor.
    const personaInput = textInputs[0];
    fireEvent.change(personaInput, { target: { value: "VP Sales" } });

    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(last.persona).toBe("VP Sales");
    expect(last.trigger_event).toBe("Reply Classified");
    expect(last.trigger_priority).toBe(2);
  });

  it("switching to Opened removes the condition secondary input", () => {
    const { onChange } = renderEditor();
    // Start from Reply Classified — classification dropdown is visible.
    expect(screen.getByText("Classification")).toBeInTheDocument();

    const eventSelect = document.querySelector("select") as HTMLSelectElement;
    fireEvent.change(eventSelect, { target: { value: "Opened" } });

    expect(screen.queryByText("Classification")).toBeNull();
    expect(
      screen.getByText(/No additional condition needed for Opened/)
    ).toBeInTheDocument();

    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(last.trigger_event).toBe("Opened");
    expect(last.trigger_condition).toEqual({});
  });

  it("editing priority fires onChange with new priority number", () => {
    const { onChange } = renderEditor({ trigger_priority: 1 });
    const numberInputs = document.querySelectorAll(
      'input[type="number"]'
    ) as NodeListOf<HTMLInputElement>;
    // Priority is the last number input (days only shows for No Reply).
    const priorityInput = numberInputs[numberInputs.length - 1];
    fireEvent.change(priorityInput, { target: { value: "5" } });

    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(last.trigger_priority).toBe(5);
  });
});
