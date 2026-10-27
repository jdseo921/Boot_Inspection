package io.github.jdseo921.bootinspection.common;

import org.springframework.core.convert.converter.Converter;
import org.springframework.stereotype.Component;

/** Lets query parameters use the wire form, e.g. {@code ?defectClass=pin_hole}. */
@Component
public class DefectClassConverter implements Converter<String, DefectClass> {

    @Override
    public DefectClass convert(String source) {
        return DefectClass.fromWire(source.trim());
    }
}
