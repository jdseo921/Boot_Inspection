package io.github.jdseo921.bootinspection.common;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * The six defect classes of the public DeepPCB benchmark. On the wire and in
 * the database they are lower-case ({@code pin_hole}).
 */
public enum DefectClass {
    OPEN("open"),
    SHORT("short"),
    MOUSEBITE("mousebite"),
    SPUR("spur"),
    COPPER("copper"),
    PIN_HOLE("pin_hole");

    private final String wire;

    DefectClass(String wire) {
        this.wire = wire;
    }

    @JsonValue
    public String wire() {
        return wire;
    }

    @JsonCreator
    public static DefectClass fromWire(String value) {
        for (DefectClass c : values()) {
            if (c.wire.equals(value)) {
                return c;
            }
        }
        throw new IllegalArgumentException("unknown defect class: " + value);
    }
}
