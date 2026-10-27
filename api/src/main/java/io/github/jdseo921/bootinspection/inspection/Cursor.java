package io.github.jdseo921.bootinspection.inspection;

import io.github.jdseo921.bootinspection.common.ApiException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.Base64;

/**
 * Keyset-pagination position: the (inspectedAt, id) of the last row served.
 * Opaque to clients. Unlike OFFSET, the next page costs the same however deep
 * the client has paged, and rows arriving meanwhile do not shift pages.
 */
public record Cursor(Instant inspectedAt, long id) {

    public String encode() {
        String raw = inspectedAt + "|" + id;
        return Base64.getUrlEncoder().withoutPadding().encodeToString(raw.getBytes(StandardCharsets.UTF_8));
    }

    public static Cursor decode(String token) {
        try {
            String raw = new String(Base64.getUrlDecoder().decode(token), StandardCharsets.UTF_8);
            int bar = raw.indexOf('|');
            if (bar < 0) {
                throw new IllegalArgumentException("no separator");
            }
            return new Cursor(Instant.parse(raw.substring(0, bar)), Long.parseLong(raw.substring(bar + 1)));
        } catch (IllegalArgumentException | DateTimeParseException e) {
            throw ApiException.badRequest("cursor is not valid; start again without it");
        }
    }
}
