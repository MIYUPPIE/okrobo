// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TEMPLATE_OPTIONS } from "./robotTemplates";
import { TemplateDialog } from "./TemplateDialog";

afterEach(() => cleanup());

describe("TemplateDialog", () => {
  it("lists every template by label and description", () => {
    render(<TemplateDialog onPick={() => {}} onCancel={() => {}} />);
    for (const template of TEMPLATE_OPTIONS) {
      expect(screen.getByText(template.label)).toBeTruthy();
      expect(screen.getByText(template.description)).toBeTruthy();
    }
  });

  it("clicking a template row calls onPick with that template's RobotDef", async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<TemplateDialog onPick={onPick} onCancel={() => {}} />);

    await user.click(screen.getByText("Two-Wheeled Rover"));
    expect(onPick).toHaveBeenCalledTimes(1);
    const picked = onPick.mock.calls[0][0];
    expect(picked.id).toBe("two-wheeled-rover");
    expect(picked.bodies.map((b: { id: string }) => b.id)).toEqual(["chassis", "left_wheel", "right_wheel"]);
  });

  it("cancels via Cancel and via clicking the backdrop, without picking anything", async () => {
    const onPick = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<TemplateDialog onPick={onPick} onCancel={onCancel} />);

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    await user.click(container.querySelector(".dialog-backdrop")!);
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("clicking inside the dialog does not trigger the backdrop cancel", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<TemplateDialog onPick={() => {}} onCancel={onCancel} />);

    await user.click(screen.getByText("New robot"));
    expect(onCancel).not.toHaveBeenCalled();
  });
});
