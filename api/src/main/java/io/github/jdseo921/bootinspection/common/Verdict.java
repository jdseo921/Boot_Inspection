package io.github.jdseo921.bootinspection.common;

/** What the AOI machine decided about a board. */
public enum Verdict {
    /** Passed; no region flagged. */
    OK,
    /** Flagged with moderate confidence; an operator should look. */
    REVIEW,
    /** Flagged with high confidence; still confirmed by an operator. */
    NG
}
