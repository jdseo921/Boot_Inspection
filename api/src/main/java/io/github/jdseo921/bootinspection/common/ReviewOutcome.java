package io.github.jdseo921.bootinspection.common;

/** What an operator decided after looking at a flagged board. */
public enum ReviewOutcome {
    /** The board really is defective. */
    CONFIRMED_DEFECT,
    /** The machine flagged a good board. */
    FALSE_CALL
}
