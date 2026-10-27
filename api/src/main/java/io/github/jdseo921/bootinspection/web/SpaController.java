package io.github.jdseo921.bootinspection.web;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/**
 * The React app uses client-side routes. When the production jar serves the
 * built front end, a reload on one of those routes must return index.html,
 * not a 404. Keep this list in step with web/src/routes.tsx.
 */
@Controller
public class SpaController {

    @GetMapping({"/", "/review", "/inspections", "/inspections/{id}", "/defects"})
    public String index() {
        return "forward:/index.html";
    }
}
