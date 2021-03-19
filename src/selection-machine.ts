import { createMachine, assign, Sender } from "xstate";
import { parseInput } from "./rank";
import type {
    ExecDoneEvent,
    InputEvent,
    SelectEvent,
    SetCommandsEvent,
    StepEvent,
    ExecEvent,
    OpenEvent,
    CloseEvent,
    MachineEvents,
    MachineContextState,
} from "./types";

export const selectionMachine = createMachine<MachineContextState, MachineEvents>(
    {
        id: "result-selection",
        initial: "closed",
        context: {
            input: "",
            commands: [],
            resultIds: [],
            selectedId: "",
            toggleKey: "p",
            sortFn: (c) => c,
        },
        states: {
            closed: {
                invoke: { src: "setupOpenListener" },
                on: {
                    OPEN: "open",
                },
            },
            open: {
                invoke: { src: "setupInteractionListener" },
                on: {
                    CLOSE: "closed",
                    EXEC: {
                        target: ".executing",
                        cond: "isExecutable",
                    },
                    SELECT: {
                        actions: "select",
                        target: ".selected",
                    },
                },
                initial: "autoSelected",
                states: {
                    executing: {
                        invoke: {
                            src: "exec",
                        },
                        on: {
                            EXEC_DONE: {
                                target: "#result-selection.closed",
                                actions: "clearInputAndResults",
                            },
                        },
                    },
                    autoSelected: {
                        entry: "selectFirst",
                        on: {
                            STEP: { target: "selected", actions: "step" },
                            NEW_COMMANDS: {
                                actions: "setCommandsAndResults",
                                target: "autoSelected",
                            },
                            INPUT: {
                                actions: "saveInputAndResults",
                                target: "autoSelected",
                            },
                        },
                    },
                    selected: {
                        on: {
                            STEP: { actions: "step" },
                            NEW_COMMANDS: {
                                actions: "setCommandsAndResults",
                                target: "selectionValidation",
                            },
                            INPUT: {
                                actions: "saveInputAndResults",
                                target: "selectionValidation",
                            },
                        },
                    },
                    selectionValidation: {
                        always: [
                            {
                                target: "selected",
                                cond: "selectedExists",
                            },
                            { target: "autoSelected" },
                        ],
                    },
                },
            },
        },
    },
    {
        services: {
            setupOpenListener: (context) => (callback: Sender<OpenEvent>) => {
                const toggleFn = (e: KeyboardEvent) => {
                    const { key } = e;
                    // @ts-ignore
                    if (e.target.tagName === "INPUT") {
                        return;
                    }
                    if (key === context.toggleKey) {
                        e.preventDefault();
                        callback("OPEN");
                    }
                };
                document.addEventListener("keyup", toggleFn);
                return () => document.removeEventListener("keyup", toggleFn);
            },
            setupInteractionListener: () => (callback: Sender<ExecEvent | CloseEvent | StepEvent>) => {
                const listenerFn = (e: KeyboardEvent) => {
                    const { key } = e;
                    if (key === "Escape") {
                        callback("CLOSE");
                        return;
                    }
                    if (key === "Enter") {
                        callback("EXEC");
                        return;
                    }
                    if (key === "ArrowDown") {
                        e.preventDefault();
                        callback({ type: "STEP", direction: "DOWN" });
                        return;
                    }
                    if (key === "ArrowUp") {
                        e.preventDefault();
                        callback({ type: "STEP", direction: "UP" });
                        return;
                    }
                };
                document.addEventListener("keydown", listenerFn);
                return () => document.removeEventListener("keydown", listenerFn);
            },
            exec: (context, event: ExecEvent) => (callback: Sender<ExecDoneEvent>) => {
                const id: string = event.id || context.selectedId;
                const parsedInput = parseInput(context.input);
                const executedCommand = context.commands.filter((c) => c.id === id);
                if (executedCommand && executedCommand.length) {
                    executedCommand[0].exec(executedCommand[0], parsedInput);
                }
                const sendEvent: ExecDoneEvent = { type: "EXEC_DONE", id, input: parsedInput };
                callback(sendEvent);
            },
        },
        actions: {
            saveInputAndResults: assign<MachineContextState, MachineEvents>({
                input: (_, event: InputEvent) => event.input,
                resultIds: (context, event: InputEvent) => {
                    if (event.input.length) {
                        const results = context.sortFn(context.commands, event.input);
                        if (results !== null) {
                            return results.map((r) => r.id);
                        }
                        return context.resultIds;
                    }
                    return [];
                },
            }),
            clearInputAndResults: assign<MachineContextState>({ input: () => "", resultIds: () => [] }),
            select: assign<MachineContextState, MachineEvents>({ selectedId: (_, event: SelectEvent) => event.id }),
            selectFirst: assign<MachineContextState>({
                selectedId: (context) => context.resultIds[0] || "",
            }),
            setCommandsAndResults: assign<MachineContextState, MachineEvents>({
                commands: (_, event: SetCommandsEvent) => {
                    return event.commands;
                },
                resultIds: (context, event: SetCommandsEvent) => {
                    if (context.input.length) {
                        const results = context.sortFn(event.commands, context.input);
                        if (results !== null) {
                            return results.map((r) => r.id);
                        }
                        return context.resultIds;
                    }
                    return [];
                },
            }),
            step: assign<MachineContextState, MachineEvents>({
                selectedId: (context, event: StepEvent) => {
                    if (!context.resultIds.length) {
                        return "";
                    }
                    const currentIndex = context.resultIds.indexOf(context.selectedId);
                    if (event.direction === "DOWN") {
                        if (currentIndex === context.resultIds.length - 1) {
                            return context.resultIds[0];
                        }
                        return context.resultIds[currentIndex + 1];
                    }
                    if (event.direction === "UP") {
                        if (currentIndex === 0) {
                            return context.resultIds[context.resultIds.length - 1];
                        }
                        return context.resultIds[currentIndex - 1];
                    }
                },
            }),
        },
        guards: {
            selectedExists: (context) => context.resultIds.includes(context.selectedId),
            isExecutable: (context) =>
                context.input.length > 0 && context.resultIds.length > 0 && parseInput(context.input) !== null,
        },
    }
);
