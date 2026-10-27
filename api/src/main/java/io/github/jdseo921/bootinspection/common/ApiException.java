package io.github.jdseo921.bootinspection.common;

import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.ErrorResponseException;

/** An error the client can act on, rendered as an RFC 9457 problem detail. */
public class ApiException extends ErrorResponseException {

    private ApiException(HttpStatus status, String detail) {
        super(status, ProblemDetail.forStatusAndDetail(status, detail), null);
    }

    public static ApiException badRequest(String detail) {
        return new ApiException(HttpStatus.BAD_REQUEST, detail);
    }

    public static ApiException notFound(String detail) {
        return new ApiException(HttpStatus.NOT_FOUND, detail);
    }

    public static ApiException conflict(String detail) {
        return new ApiException(HttpStatus.CONFLICT, detail);
    }

    /** The request is well-formed but refers to things that do not fit together. */
    public static ApiException unprocessable(String detail) {
        return new ApiException(HttpStatus.valueOf(422), detail);
    }
}
