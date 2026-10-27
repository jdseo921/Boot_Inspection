package io.github.jdseo921.bootinspection.catalog;

import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
public class CatalogController {

    private final CatalogRepository catalog;

    public CatalogController(CatalogRepository catalog) {
        this.catalog = catalog;
    }

    @GetMapping("/lines")
    public List<CatalogRepository.Line> lines() {
        return catalog.lines();
    }

    @GetMapping("/products")
    public List<CatalogRepository.Product> products() {
        return catalog.products();
    }

    @GetMapping("/profiles")
    public List<CatalogRepository.Profile> profiles() {
        return catalog.profiles();
    }
}
