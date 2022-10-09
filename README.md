# `gulp-mustache-layout`

This is a quick draft of an idea I was toying with for statically generating my web site. 
This may or may not ever be finished, and/or split into a separate package.  Who knows!

This package exists to draw a distinction between Mustache reusing partials _within_ a template 
and Mustache templates being applied repeatedly across contexts to contain other templates.  
This allows you to keep a clean file structure for your static sites,
without lumping in heaps of markup within your Mustache variables themselves, 
and allowing you to take advantage of Mustache functionality deeper within your templates,
by taking care of the partial loading for you.  

Per the Mustache spec, partials invoked normally will inherit their calling context.
With `gulp-mustache-layout`, when an outer template `yield`s to an inner template, 
the context of the outer templates will be recursively passed on to the inner template
_within a scope_, which defaults to the name of the outer template.  

## `Gulpfile.ts` example

```
import { src, dest } from 'gulp'
import GulpMustacheLayout from 'gulp-mustache-layout';

import TOML from 'toml';
import Path from 'path'; 


let layoutLoader = new GulpMustacheLayout({ 
    varLoader: {
        path: parsed => Path.format( { ...parsed, base: '', ext: '.toml' } ),
        parser: TOML.parse,
    } 
})

const layouts = { 
    main: layoutLoader.load('src/layouts/main.mustache'),
}


export function html() { 
    return src("src/pages/*.mustache")
    .pipe(layouts.main.done())
    .pipe(dest("dist"))
}
```


# Goals 

 - Render nested mustache templates, as simply yet flexibly as possible
  - We do everything else, which lets it be more configurable than SSGs I've seen
 - Adhere to the Gulp plugin guidelines, which help to enforce modularity


 # Differences from normal Mustache
 - The special `yield` partial, which renders the child template.  
   Unlike normal partials, this inherits variables from the parent template **within a scope**, 
   which defaults to the file name of the parent template (without an extension)
 - Partials which explicitly start with a `./` are loaded relative to the file of the template containing them.
   Partials which do not, but are still a relative path, are loaded relative to the current working directory. 
 - The special `global` variable is bound in every template 