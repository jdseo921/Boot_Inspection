package io.github.jdseo921.bootinspection.common;

import java.sql.Connection;
import java.sql.SQLException;
import java.util.Collection;
import org.springframework.jdbc.core.SqlTypeValue;
import org.springframework.jdbc.core.support.AbstractSqlTypeValue;

/**
 * Binds a Java collection as one PostgreSQL {@code text[]} parameter, so a
 * whole ingest batch goes to the database in a single statement through
 * {@code unnest(...)}. Cast it in SQL to the element type you need, for
 * example {@code CAST(:ids AS uuid[])}.
 */
public final class PgArrays {

    private PgArrays() {}

    public static SqlTypeValue text(Collection<?> values) {
        String[] elements = values.stream().map(v -> v == null ? null : v.toString()).toArray(String[]::new);
        return new AbstractSqlTypeValue() {
            @Override
            protected Object createTypeValue(Connection con, int sqlType, String typeName) throws SQLException {
                return con.createArrayOf("text", elements);
            }
        };
    }
}
