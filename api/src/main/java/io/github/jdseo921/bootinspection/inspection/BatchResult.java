package io.github.jdseo921.bootinspection.inspection;

import java.util.List;

public record BatchResult(int received, int created, int duplicates, List<IngestResult> results) {}
