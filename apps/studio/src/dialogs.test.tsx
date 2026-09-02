// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NameDialog, OpenDialog } from "./dialogs";
import type { ProjectMeta } from "./projects/api";

afterEach(() => cleanup());

describe("NameDialog", () => {
  it("disables Save until a name is entered, then submits the trimmed value", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<NameDialog title="Save project as" onSubmit={onSubmit} onCancel={() => {}} />);

    const save = screen.getByRole("button", { name: /save/i });
    expect(save).toBeDisabled();

    await user.type(screen.getByPlaceholderText("Project name"), "  My Robot  ");
    expect(save).toBeEnabled();

    await user.click(save);
    expect(onSubmit).toHaveBeenCalledWith("My Robot");
  });

  it("does not submit whitespace-only names", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<NameDialog title="Save project as" onSubmit={onSubmit} onCancel={() => {}} />);

    await user.type(screen.getByPlaceholderText("Project name"), "   ");
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits on Enter, not just the Save button", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<NameDialog title="Save project as" onSubmit={onSubmit} onCancel={() => {}} />);

    await user.type(screen.getByPlaceholderText("Project name"), "Arm Demo{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("Arm Demo");
  });

  it("cancels via the Cancel button and via clicking the backdrop", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <NameDialog title="Save project as" onSubmit={() => {}} onCancel={onCancel} />,
    );

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    await user.click(container.querySelector(".dialog-backdrop")!);
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("clicking inside the dialog does not trigger the backdrop cancel", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<NameDialog title="Save project as" onSubmit={() => {}} onCancel={onCancel} />);

    await user.click(screen.getByText("Save project as"));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("shows the title it was given", () => {
    render(<NameDialog title="Custom Title Here" onSubmit={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("Custom Title Here")).toBeTruthy();
  });
});

describe("OpenDialog", () => {
  const projects: ProjectMeta[] = [
    { id: "p1", name: "Wall Avoider", created_at: 1000, updated_at: 2_000_000 },
    { id: "p2", name: "Arm Wave", created_at: 1000, updated_at: 3_000_000 },
  ];

  it("shows an empty state when there are no projects", () => {
    render(<OpenDialog projects={[]} onOpen={() => {}} onDelete={() => {}} onCancel={() => {}} />);
    expect(screen.getByText(/no saved projects yet/i)).toBeTruthy();
  });

  it("lists every project by name", () => {
    render(
      <OpenDialog projects={projects} onOpen={() => {}} onDelete={() => {}} onCancel={() => {}} />,
    );
    expect(screen.getByText("Wall Avoider")).toBeTruthy();
    expect(screen.getByText("Arm Wave")).toBeTruthy();
  });

  it("opens the clicked project by id", async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(
      <OpenDialog projects={projects} onOpen={onOpen} onDelete={() => {}} onCancel={() => {}} />,
    );

    await user.click(screen.getByText("Arm Wave"));
    expect(onOpen).toHaveBeenCalledWith("p2");
    expect(onOpen).not.toHaveBeenCalledWith("p1");
  });

  it("requires a second click to delete, so a stray click cannot destroy a project", async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(
      <OpenDialog projects={projects} onOpen={() => {}} onDelete={onDelete} onCancel={() => {}} />,
    );

    const deleteButtons = screen.getAllByTitle("Delete project");
    await user.click(deleteButtons[0]);
    expect(onDelete).not.toHaveBeenCalled();

    // The button now asks for confirmation.
    const confirm = screen.getByText("delete?");
    await user.click(confirm);
    expect(onDelete).toHaveBeenCalledWith("p1");
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("only arms the confirmation for the project that was clicked", async () => {
    const user = userEvent.setup();
    render(
      <OpenDialog projects={projects} onOpen={() => {}} onDelete={() => {}} onCancel={() => {}} />,
    );

    await user.click(screen.getAllByTitle("Delete project")[0]);
    // The second project's delete button is untouched and still says its title.
    expect(screen.getAllByTitle("Delete project")).toHaveLength(1);
    expect(screen.getByText("delete?")).toBeTruthy();
  });

  it("cancels via Close and via the backdrop", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <OpenDialog projects={projects} onOpen={() => {}} onDelete={() => {}} onCancel={onCancel} />,
    );

    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    await user.click(container.querySelector(".dialog-backdrop")!);
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
