package jumpking.config;

import java.io.IOException;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.web.servlet.resource.PathResourceResolver;

@Configuration
public class WebConfiguration implements WebMvcConfigurer {
  @Override
  public void addResourceHandlers(ResourceHandlerRegistry registry) {
    registry
        .addResourceHandler("/**")
        .addResourceLocations("classpath:/static/")
        .setCacheControl(CacheControl.noCache())
        .resourceChain(true)
        .addResolver(
            new PathResourceResolver() {
              @Override
              protected Resource getResource(String path, Resource location) throws IOException {
                Resource resource = super.getResource(path, location);
                if (resource != null) return resource;
                if (path.equals("api")
                    || path.startsWith("api/")
                    || path.equals("ws")
                    || path.startsWith("ws/")
                    || path.equals("assets")
                    || path.startsWith("assets/")
                    || path.contains(".")
                    || path.contains("..")) return null;
                return super.getResource("index.html", location);
              }
            });
  }
}
