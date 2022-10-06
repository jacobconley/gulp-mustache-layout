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

    varLoader ?: { 
        path:   (parsedPath: ParsedPath) => string, 
        parser: (contents: string) => any, 
    }

    vars ?: any 
}


interface RenderChainOptions extends GlobalOptions { 

    /**
     * The name of the object containing this template's variables when accessed from within an inner template.  
     * Defaults to the file name of the `.mustache` template. 
     * Set to `null` to disable inheritance altogether.
     */
    scopeName ?: string | null
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


    /**
     * Reloads the template
     */
    reload() : void 
}



//
// Implementation
//







/**
 * This is the highest-level instance of `gulp-mustache-layout`.
 * Use the constructor to create an instance, and then invoke its instance methods to get started. 
 */
export default class GulpMustacheLayout { 
    globalOptions : GlobalOptions

    /**
     * Creates a new top-level `gulp-mustache-layout` instance.
     * @param options Global options that will be used as defaults for everything created by this instance.
     * These options can be overridden further down the chain.  
     */
    constructor(options : GlobalOptions = {}) { 
        this.globalOptions = options 
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
        return Template.Load(this, null, path, Object.assign({}, this.globalOptions, options ?? {}))
    }
}





interface TemplatePath { 
    full : string, 
    info : ParsedPath, 
}


interface TemplateInitializer { 

    /**
     * The path information corresponding to the template 
     */
    path : TemplatePath

    templateContents : string 
    loadedVars ?: any 

    /**
     * The plugin instance that created this instance
     */
    plugin : GulpMustacheLayout

    /**
     * The template that wraps this one, if applicable
     */
    parent : Template | null

    effectiveOptions : RenderChainOptions
}


class Template implements RenderChain, TemplateInitializer {  

    path : TemplatePath

    plugin: GulpMustacheLayout
    parent: Template | null
    effectiveOptions : RenderChainOptions

    templateContents : string 
    loadedVars ?: any 

    //
    // Initializers
    //

    /**
     * Don't call this directly; use the static initializers
     * `Load`, `FromVinyl`, and `Literal`
     */
    constructor(x: TemplateInitializer) { 
        this.plugin   = x.plugin 
        this.path     = x.path 
        this.parent   = x.parent 
        this.effectiveOptions  = x.effectiveOptions

        this.templateContents   = x.templateContents
        this.loadedVars         = x.loadedVars
    }

    /**
     * Loads a Mustache file from the specified path 
     * @param path The file path on the operating system
     * @param effectiveOptions User-defined options for the loading of this template
     * @param parent The template which "wraps" or yields to this new template
     * @returns A new `Template` instance
     */
    static Load(plugin : GulpMustacheLayout, parent : Template | null, path : string, effectiveOptions: RenderChainOptions) : Template { 

        let pathInfo = Path.parse(path) 
        let pathObj : TemplatePath = { full: path, info: pathInfo }

        return new Template({ 
            plugin, parent, effectiveOptions,
            path: pathObj,

            templateContents:   Template.LoadContents(pathObj),
            loadedVars:         Template.LoadVars(pathObj, effectiveOptions), 
        })
    }

    /**
     * Instantiates a `Template` from a Vinyl object 
     * @param vinyl The file object piped into this plugin
     * @param pathInfo The object returned by `Path.parse` - provided separately since this is re-used by the stream object
     * @param effectiveOptions User-defined options for the loading of this template
     * @param parent The template which "wraps" or yields to this new template
     * @returns A new `Template` instance
     */
    static FromVinyl(plugin : GulpMustacheLayout, parent : Template | null, vinyl : Vinyl, pathInfo: ParsedPath, effectiveOptions : RenderChainOptions) : Template { 

        let inputContents = vinyl.contents?.toString()
        if(! inputContents) throw new PluginError(PLUGIN, "Undefined contents of file")

        let pathObj = { full: vinyl.path, info: pathInfo } 

        return new Template({
            plugin, parent, effectiveOptions, 
            path: pathObj, 

            templateContents:   inputContents, 
            loadedVars:         Template.LoadVars(pathObj, effectiveOptions), 
        })

    }

    //
    // Static helpers
    //


    static LoadContents(path: TemplatePath) : string { 
        try { 
            return FS.readFileSync(path.full).toString()
        }
        catch(err) { 
            throw new PluginError(PLUGIN, `Reading file ${path.full}: ${err}`)
        }

    }

    static LoadVars(path: TemplatePath, options: RenderChainOptions) : any { 

        let varReader = options.varLoader 
        if(varReader) { 
            let varPathResult = varReader.path(path.info)
            let varPath : string = varPathResult

            let varContents 
            try { 
                varContents = FS.readFileSync( varPath ).toString() 
            }
            catch(err){ 
                let e = err as { code ?: string }
                if(e.code == 'ENOENT') { 
                    console.debug("Template file not found, skipping: " + varPath)
                    return {}
                }
                else throw new PluginError(PLUGIN, `Reading var file ${varPath}: ${e}`)
            }

            try { 
                let x = varReader.parser(varContents) 
                return x 
            }
            catch(err) { 
                throw new PluginError(PLUGIN, `While executing varReader on ${varPath}: ${err}`, { showStack: true })
            }
        }
        else return {} 
    }


    //
    // Instance methods
    //

    mergedVars() : any { 
        return Object.assign({}, this.loadedVars, this.effectiveOptions.vars) 
    }

    /**
     * Joins the `vars` object specific to this template with inherited variables from parent templates 
     * @returns A newly-initialized view object passed on to Mustache
     */
    effectiveVars() : any { 
        let res = this.mergedVars()

        // Inherits parent templates via their scopes 
        for(let p = this.parent; p; p = p.parent) { 
            if(p.effectiveOptions.scopeName !== null) res[p.effectiveOptions.scopeName ?? p.path.info.name] = p.mergedVars()
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
            return Mustache.render(this.templateContents, this.effectiveVars(), loadPartial)
        }
        catch(err) { 
            if(err instanceof PluginError) throw err
            throw new PluginError(PLUGIN, "While rendering template", { showStack: true })
        }

    }


    //
    // Plugin interface implementation
    //


    wrap({ path, templateContents, loadedVars, effectiveOptions }: Template): RenderChain {
        return new Template({ 
            path, templateContents, loadedVars, effectiveOptions, 
            plugin: this.plugin, 
            parent: this, 
        })
    }

    done(options?: RenderStreamOptions | undefined): RenderStream {
        return new RenderStream(this, Object.assign({}, this.plugin.globalOptions, options ?? {}))
    }

    reload(): void {
        this.templateContents   = Template.LoadContents(this.path) 
        this.loadedVars         = Template.LoadVars(this.path, this.effectiveOptions)
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
        // Ignore non-mustache files, so that var files don't get processed
        if(file.extname != '.mustache') return callback() 

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
