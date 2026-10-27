package io.github.jdseo921.bootinspection.inspection;

import java.util.List;

/**
 * @param nextCursor pass as {@code cursor} to get the next page; null on the last page
 */
public record PageView<T>(List<T> items, String nextCursor) {}
