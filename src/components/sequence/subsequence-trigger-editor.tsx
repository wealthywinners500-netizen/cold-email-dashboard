"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface SubsequenceTriggerEditorProps {
  trigger_event?: string | null;
  trigger_condition?: Record<string, unknown> | null;
  trigger_priority?: number;
  persona?: string | null;
  onChange: (config: {
    trigger_event: string;
    trigger_condition: Record<string, unknown>;
    trigger_priority: number;
    persona: string;
  }) => void;
}

const classificationOptions = [
  "INTERESTED",
  "OBJECTION",
  "POLITE_DECLINE",
  "NOT_INTERESTED",
  "AUTO_REPLY",
  "BOUNCE",
  "STOP",
];

const triggerEventOptions = [
  "Reply Classified",
  "No Reply",
  "Opened",
  "Clicked",
];

export function SubsequenceTriggerEditor({
  trigger_event,
  trigger_condition,
  trigger_priority,
  persona,
  onChange,
}: SubsequenceTriggerEditorProps) {
  const [localTriggerEvent, setLocalTriggerEvent] = useState<string>(trigger_event || "Reply Classified");
  const [localClassification, setLocalClassification] = useState<string>(
    (trigger_condition as any)?.classification || "INTERESTED"
  );
  const [localDays, setLocalDays] = useState<number>(
    (trigger_condition as any)?.days || 3
  );
  const [localPriority, setLocalPriority] = useState<number>(trigger_priority || 1);
  const [localPersona, setLocalPersona] = useState<string>(persona || "");

  const handleTriggerEventChange = (event: string) => {
    setLocalTriggerEvent(event);
    const condition =
      event === "Reply Classified"
        ? { classification: localClassification }
        : event === "No Reply"
        ? { days: localDays }
        : {};

    onChange({
      trigger_event: event,
      trigger_condition: condition,
      trigger_priority: localPriority,
      persona: localPersona,
    });
  };

  const handleClassificationChange = (classification: string) => {
    setLocalClassification(classification);
    onChange({
      trigger_event: localTriggerEvent,
      trigger_condition: { classification },
      trigger_priority: localPriority,
      persona: localPersona,
    });
  };

  const handleDaysChange = (days: number) => {
    setLocalDays(days);
    onChange({
      trigger_event: localTriggerEvent,
      trigger_condition: { days },
      trigger_priority: localPriority,
      persona: localPersona,
    });
  };

  const handlePriorityChange = (priority: number) => {
    setLocalPriority(priority);
    onChange({
      trigger_event: localTriggerEvent,
      trigger_condition: trigger_condition || {},
      trigger_priority: priority,
      persona: localPersona,
    });
  };

  const handlePersonaChange = (newPersona: string) => {
    setLocalPersona(newPersona);
    onChange({
      trigger_event: localTriggerEvent,
      trigger_condition: trigger_condition || {},
      trigger_priority: localPriority,
      persona: newPersona,
    });
  };

  return (
    <Card className="bg-gray-900 border-gray-800">
      <CardHeader>
        <CardTitle className="text-white">Trigger Configuration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Trigger Event */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Trigger Event
          </label>
          <select
            value={localTriggerEvent}
            onChange={(e) => handleTriggerEventChange(e.target.value)}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white"
          >
            {triggerEventOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        {/* Condition based on trigger event */}
        {localTriggerEvent === "Reply Classified" && (
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Classification
            </label>
            <select
              value={localClassification}
              onChange={(e) => handleClassificationChange(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white"
            >
              {classificationOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        )}

        {localTriggerEvent === "No Reply" && (
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Days Without Reply
            </label>
            <input
              type="number"
              min="1"
              value={localDays}
              onChange={(e) => handleDaysChange(parseInt(e.target.value))}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white"
            />
          </div>
        )}

        {(localTriggerEvent === "Opened" || localTriggerEvent === "Clicked") && (
          <div className="text-sm text-gray-400 py-2">
            No additional condition needed for {localTriggerEvent} events.
          </div>
        )}

        {/* Priority */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Priority (Lower number fires first)
          </label>
          <input
            type="number"
            min="1"
            value={localPriority}
            onChange={(e) => handlePriorityChange(parseInt(e.target.value))}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white"
          />
        </div>

        {/* Persona */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Persona (Required)
          </label>
          <input
            type="text"
            value={localPersona}
            onChange={(e) => handlePersonaChange(e.target.value)}
            placeholder="e.g., Decision Maker, IT Admin"
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white"
          />
        </div>
      </CardContent>
    </Card>
  );
}
