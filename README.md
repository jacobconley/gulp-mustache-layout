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
import FS from 'fs'; 
import Path from 'path'; 

const TomlReader = (info: Path.ParsedPath) => { 
    let path = Path.format( { ...info, base: '', ext: '.toml' } )
    try { return TOML.parse(FS.readFileSync(path).toString()) }
    catch(err) { 
        let e = err as { code ?: string }
        if(e.code == 'ENOENT') { console.debug("ENOENT " + path); return null  }
        else throw err 
    }
}

let layoutLoader = new GulpMustacheLayout()
const layouts = { 
    main: layoutLoader.load('src/layouts/main.mustache').readVars(TomlReader),
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