import * as Stream from 'stream'
import Path, { dirname, ParsedPath } from 'path';
import FS from 'fs';

import PluginError from 'plugin-error';
import Vinyl from 'vinyl';

import Mustache from 'mustache';

const PLUGIN = 'gulp-mustache-layout'


//
// Options
//



interface GlobalOptions { 
    /**
     * A function that dynamically provides variables to Mustache based on the input file.
     * For example, this can be used to load variables from a configuration file for each template.
     * 
     * If `vars` is also provided, the return value of this function will be merged into it, 
     * with the `vars`'s values overwriting this function's return value where applicable. 
     * @param pathInfo The `ParsedPath` of the `.mustache` file for the template being rendered.
     * @returns A "view" object with variable bindings passed to Mustache
     */
     varReader ?: (pathInfo : ParsedPath) => any
}


interface RenderChainOptions extends GlobalOptions { 

    /**
     * The name of the object containing this template's variables when accessed from within an inner template.  
     * Defaults to the file name of the `.mustache` template. 
     */
    scopeName ?: string
}

interface RenderStreamOptions extends RenderChainOptions { 
    /**
     * The name of the rendered file, 
     * which may be created within the directory specified by `dest`. 
     * Defaults to the input name of the file. 
     */
    outputName ?: string, 

    /**
     * The extension of the rendered file.
     * Defaults to `.htm`. 
     */
    outputExtension ?: string, 
}




//
// Implementation
//







/**
 * This is the highest-level instance of `gulp-mustache-layout`.
 * Use the constructor to create an instance, and then invoke its instance methods to get started. 
 */
export default class GulpMustacheLayout { 
    options : GlobalOptions

    /**
     * Creates a new top-level `gulp-mustache-layout` instance.
     * @param options Global options that will be used as defaults for everything created by this instance.
     * These options can be overrided further down the chain.  
     */
    constructor(options : GlobalOptions = {}) { 
        this.options = options 
    }

    /**
     * Loads a `.mustache` file as a Layout.
     * 
     * The returned object can then be chained into other nested Layouts using the `.wrap` method.
     * After you have loaded all of your layouts, call `.done()` to create the stream object
     * that is used in the Gulp pipeline. 
     * @param path The file path of the outermost template
     * @param options Options specific to this template rendering
     * @returns An instance that can be chained to other Layouts or used to render the final template
     */
    load(path: string, options ?: RenderChainOptions) : RenderChain { 
        return Template.Load(this, null, path, options ?? {})
    }
}

export interface RenderChain { 
    /**
     * Wraps the current template within another "inner" template that is loaded from the filesystem.
     * This is used to chain together multiple layouts before rendering the final file loaded through the Gulp pipeline. 
     * 
     * After all relevant layouts are loaded, call `done()` and then pass the resulting object to your next `.pipe` call.
     * 
     * @example
     * ```
     * let GMLayout = new GulpMustacheLayout() 
     * const layouts = { 
     *      main:     GMLayout.load("foo.mustache")
     *      blogPost: GMLayout.load("bar.mustache") 
     * }
     * 
     * src("post.mustache")
     * .pipe( 
     *  layouts.main
     *  .wrap(layouts.blogPost)
     *  .done() 
     * )
     * ```
     * @param child The loaded template, obtained from a `GulpMustacheLayout` instance
     */
    wrap(child : RenderChain) : RenderChain 

    /**
     * Finishes the template chain.  
     * The object returned by this can be passed as an argument to Gulp's `.pipe` method.
     * @param options Options specific to the rendering of innermost template file - 
     * i.e. the file going through the Gulp pipeline. 
     */
    done(options ?: RenderStreamOptions) : RenderStream


    withVars(vars: any) : RenderChain

    readVars(reader: (pathInfo : ParsedPath) => any) : RenderChain

}






interface TemplatePath { 
    full : string, 
    info : ParsedPath, 
}


interface TemplateInitializer { 
    /**
     * The raw contents of the Mustache template
     */
    contents: string

    /**
     * The path information corresponding to the template 
     * _if it was loaded from a file_,
     * undefined if passed in as a literal
     */
    path : TemplatePath

    /**
     * The variable bindings specific to this template, 
     * not including any inherited bindings from parent template.  
     * 
     * This is always initialized from a new object, 
     * separate from any options passed into the plugin 
     */
    vars : any

    /**
     * The plugin instance that created this instance
     */
    plugin : GulpMustacheLayout

    /**
     * The template that wraps this one, if applicable
     */
    parent : Template | null

    options : RenderChainOptions
}

class Template implements RenderChain, TemplateInitializer {  

    contents: string
    path: TemplatePath
    vars: any
    plugin: GulpMustacheLayout
    parent: Template | null
    options : RenderChainOptions


    //
    // Initializers
    //

    /**
     * Don't call this directly; use the static initializers
     * `Load`, `FromVinyl`, and `Literal`
     */
    constructor(x: TemplateInitializer) { 
        this.plugin   = x.plugin 
        this.contents = x.contents 
        this.path     = x.path 
        this.vars     = x.vars 
        this.parent   = x.parent 
        this.options  = x.options
    }

    /**
     * Loads a Mustache file from the specified path 
     * @param path The file path on the operating system
     * @param options User-defined options for the loading of this template
     * @param parent The template which "wraps" or yields to this new template
     * @returns A new `Template` instance
     */
    static Load(plugin : GulpMustacheLayout, parent : Template | null, path : string, options: RenderChainOptions) : Template { 
        console.debug("Loading " + path) 

        let pathInfo = Path.parse(path) 

    
        let contents; 
        try { 
            contents = FS.readFileSync(path).toString()
        }
        catch(err) { 
            throw new PluginError(PLUGIN, `Reading file ${path}: ${err}`)
        }

        return new Template({ 
            plugin, contents, parent, options,
            vars: {}, 
            path: { full: path, info: pathInfo },
        })
    }

    /**
     * Instantiates a `Template` from a Vinyl object 
     * @param vinyl The file object piped into this plugin
     * @param pathInfo The object returned by `Path.parse` - provided separately since this is re-used by the stream object
     * @param options User-defined options for the loading of this template
     * @param parent The template which "wraps" or yields to this new template
     * @returns A new `Template` instance
     */
    static FromVinyl(plugin : GulpMustacheLayout, parent : Template | null, vinyl : Vinyl, pathInfo: ParsedPath, options : RenderChainOptions) : Template { 
        console.debug("Loading from vinyl at " + vinyl.path)

        let inputContents = vinyl.contents?.toString()
        if(! inputContents) throw new PluginError(PLUGIN, "Undefined contents of file")

        return new Template({
            plugin, parent, options, 
            contents: inputContents.toString(),
            vars: {}, 
            path: { full: vinyl.path, info: pathInfo }
        })

    }






    readVars(reader: (pathInfo: Path.ParsedPath) => any): RenderChain {
        if(! this.path) { 
            throw new PluginError(PLUGIN, "Cannot readVars on a template literal - no path to read from!")
        }
        try { 
            let loaded = reader(this.path.info)
            console.debug("varReader", loaded)
            Object.assign(this.vars, loaded)
            return this.withVars(loaded)
        }
        catch(err) { 
            throw new PluginError(PLUGIN, "While executing varReader:" + err, { showStack: true })
        }
    }

    withVars(newVars: any): RenderChain {
        return new Template(
            Object.assign({}, this, { 
                vars: Object.assign({}, this.vars, newVars)
            })
        )
    }

    //
    // Instance methods
    //


    /**
     * Joins the `vars` object specific to this template with inherited variables from parent templates 
     * @returns A newly-initialized view object passed on to Mustache
     */
    effectiveVars() : any { 
        let res : any = {}
        for(let p = this.parent; p; p = p.parent) { 
            if(p.options.scopeName) res[p.options.scopeName] = p.vars
        }
        return res 
    }

    /**
     * Renders this template instance, with the provided `yieldContents` if applicable
     * 
     * Throws an error if `yield` is invoked without `yieldContents`
     * @param yieldContents The contents to render for the `yield` placeholder, if any
     * @returns The render result, as a `string`
     */
    renderStep(yieldContents : string | null) : string { 

        const loadPartial = (name: string) => { 
            if(name == 'yield') { 
                if(yieldContents) return yieldContents
                else throw new PluginError(PLUGIN, `No contents to yield in ${this.path?.full ?? 'template literal'}`)
            }

            else if(this.path) { 
                const path = Path.resolve(this.path.info.dir, name + '.mustache')
                return FS.readFileSync(path).toString() 
            }

            else throw new PluginError(PLUGIN, "Cannot render partial - no directory name (is this a template literal?)")
        }

        try { 
            return Mustache.render(this.contents, this.effectiveVars(), loadPartial)
        }
        catch(err) { 
            if(err instanceof PluginError) throw err
            throw new PluginError(PLUGIN, "While rendering template", { showStack: true })
        }

    }


    //
    // Plugin interface implementation
    //


    wrap({ contents, path, vars, options }: Template): RenderChain {
        return new Template({ 
            contents, path, vars, options, 
            plugin: this.plugin, 
            parent: this, 
        })
    }

    done(options?: RenderStreamOptions | undefined): RenderStream {
        return new RenderStream(this, Object.assign({}, this.plugin.options, options ?? {}))
    }
}



/**
 * The stream object used by Gulp
 */
class RenderStream extends Stream.Transform { 

    options : RenderStreamOptions
    parent : Template

    constructor(parent : Template, options : RenderStreamOptions) { 
        super({ objectMode: true })
        this.parent = parent 
        this.options = options 
    }


    _transform(file: Vinyl, encoding: BufferEncoding, callback: Stream.TransformCallback): void {
        if(file.isNull()) { 
            this.push(file); 
            return callback(); 
        }
        if(file.isStream()) { 
            this.emit('error', new PluginError(PLUGIN, 'Streams are not yet supported'))
            return callback();
        }

        // Ignore partials, so that globs don't render them independently
        if(file.basename.startsWith("_")) return callback()

        try { 
            let pathInfo = Path.parse(file.path)
            let template = Template.FromVinyl(this.parent.plugin, this.parent, file, pathInfo, this.options) 

            let output = template.renderStep(null)
            for(let t : Template | null = this.parent; t; t = t.parent) output = t.renderStep(output) 


            file.contents = Buffer.from(output) 
            file.path = pathInfo.dir + Path.sep 
                + (this.options.outputName ?? pathInfo.name) 
                + (this.options.outputExtension ?? '.htm')
            
            this.push(file) 

        }
        catch(err) { 
            if(err instanceof PluginError) this.emit('error', err) 
            else if(err instanceof Error) this.emit('error', new PluginError(PLUGIN, err, { showStack: true }))
            else this.emit('error', new PluginError(PLUGIN, "Error during rendering: " + err))
        }

        return callback()
    }

}
