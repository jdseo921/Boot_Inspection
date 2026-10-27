package io.github.jdseo921.bootinspection.inspection;

import java.util.UUID;

/**
 * @param created false when the station had already sent this externalId;
 *     the stored record is left as it was
 */
public record IngestResult(long id, UUID externalId, boolean created) {}
