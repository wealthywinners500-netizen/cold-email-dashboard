/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CreateSubsequenceModal } from "../create-subsequence-modal";

const fetchMock = vi.fn();
const onCreated = vi.fn();
const onOpenChange = vi.fn();

function renderModal() {
  return render(
    <CreateSubsequenceModal
      open={true}
      onOpenChange={onOpenChange}
      campaignId="camp-1"
      onCreated={onCreated}
    />
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  onCreated.mockReset();
  onOpenChange.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({
        id: "seq-1",
        org_id: "org-1",
        campaign_id: "camp-1",
        name: "Decision-maker nudge",
        sequence_type: "subsequence",
        sort_order: 0,
        trigger_event: "Reply Classified",
        trigger_condition: { classification: "INTERESTED" },
        trigger_priority: 1,
        persona: "CFO",
        steps: [],
        status: "active",
        created_at: "2026-04-17T00:00:00Z",
        updated_at: "2026-04-17T00:00:00Z",
      }),
      { status: 201 }
    )
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CreateSubsequenceModal", () => {
  it("submits Reply Classified with classification condition + empty steps", async () => {
    renderModal();

    // Fill name + persona.
    const form = screen.getByRole("button", { name: /Create subsequence/ }).closest("form")!;
    const inputs = form.querySelectorAll('input[type="text"]');
    fireEvent.change(inputs[0], { target: { value: "Decision-maker nudge" } });
    fireEvent.change(inputs[1], { target: { value: "CFO" } });

    fireEvent.click(screen.getByRole("button", { name: /Create subsequence/ }));
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchMock).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/campaigns/camp-1/sequences");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toEqual(
      expect.objectContaining({
        name: "Decision-maker nudge",
        sequence_type: "subsequence",
        trigger_event: "Reply Classified",
        trigger_condition: { classification: "INTERESTED" },
        trigger_priority: 1,
        persona: "CFO",
        steps: [],
      })
    );

    // onCreated fires with the server response; modal closes.
    expect(onCreated).toHaveBeenCalledOnce();
    expect(onCreated.mock.calls[0][0]).toMatchObject({
      id: "seq-1",
      sequence_type: "subsequence",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("No Reply + 5 days sends { days: 5 } condition", async () => {
    renderModal();
    const form = screen.getByRole("button", { name: /Create subsequence/ }).closest("form")!;
    const textInputs = form.querySelectorAll('input[type="text"]');
    fireEvent.change(textInputs[0], { target: { value: "Nudge after 5d" } });
    fireEvent.change(textInputs[1], { target: { value: "CFO" } });

    // Switch the trigger event select to "No Reply".
    const eventSelect = form.querySelectorAll("select")[0] as HTMLSelectElement;
    fireEvent.change(eventSelect, { target: { value: "No Reply" } });

    // Days input appears — set to 5.
    const daysInput = form.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(daysInput, { target: { value: "5" } });

    fireEvent.click(screen.getByRole("button", { name: /Create subsequence/ }));
    await new Promise((r) => setTimeout(r, 0));

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.trigger_event).toBe("No Reply");
    expect(body.trigger_condition).toEqual({ days: 5 });
  });

  it("Opened event sends an empty trigger_condition object", async () => {
    renderModal();
    const form = screen.getByRole("button", { name: /Create subsequence/ }).closest("form")!;
    const textInputs = form.querySelectorAll('input[type="text"]');
    fireEvent.change(textInputs[0], { target: { value: "After open" } });
    fireEvent.change(textInputs[1], { target: { value: "CFO" } });

    const eventSelect = form.querySelectorAll("select")[0] as HTMLSelectElement;
    fireEvent.change(eventSelect, { target: { value: "Opened" } });

    fireEvent.click(screen.getByRole("button", { name: /Create subsequence/ }));
    await new Promise((r) => setTimeout(r, 0));

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.trigger_event).toBe("Opened");
    expect(body.trigger_condition).toEqual({});
  });

  it("blank name → inline error, no fetch, modal stays open", async () => {
    renderModal();
    // Leave name blank; fill persona so only name fails.
    const form = screen.getByRole("button", { name: /Create subsequence/ }).closest("form")!;
    const textInputs = form.querySelectorAll('input[type="text"]');
    fireEvent.change(textInputs[1], { target: { value: "CFO" } });

    fireEvent.click(screen.getByRole("button", { name: /Create subsequence/ }));
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByText("Name is required")).toBeInTheDocument();
  });

  it("blank persona → inline error, no fetch", async () => {
    renderModal();
    const form = screen.getByRole("button", { name: /Create subsequence/ }).closest("form")!;
    const textInputs = form.querySelectorAll('input[type="text"]');
    fireEvent.change(textInputs[0], { target: { value: "Name only" } });

    fireEvent.click(screen.getByRole("button", { name: /Create subsequence/ }));
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("Persona is required")).toBeInTheDocument();
  });

  it("Cancel button closes without calling onCreated or fetch", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("4xx response surfaces inline error and keeps modal open", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "persona is required" }), { status: 400 })
    );
    renderModal();
    const form = screen.getByRole("button", { name: /Create subsequence/ }).closest("form")!;
    const textInputs = form.querySelectorAll('input[type="text"]');
    fireEvent.change(textInputs[0], { target: { value: "Nudge" } });
    fireEvent.change(textInputs[1], { target: { value: "CFO" } });

    fireEvent.click(screen.getByRole("button", { name: /Create subsequence/ }));
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.getByText("persona is required")).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
