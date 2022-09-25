import * as Stream from 'stream'
import Path from 'path';
import FS from 'fs';

import PluginError from 'plugin-error';
import Vinyl from 'vinyl';

import Mustache from 'mustache';


/**
 * `Layout` stores the contents of the outer template in which your inner templates are rendered. 
 * It is a thin wrapper around the `RenderStream` object, 
 * which is the object used in your Gulp tasks. 
 * 
 * If you have a template string already, you can pass it directly to the `new Layout(...)` constructor;
 * otherwise, use `.read(path)` to read it from the file system. 
 */
export default class Layout { 
    templateContents: string

    constructor(templateContents: string) { 
        this.templateContents = templateContents 
    }

    /**
     * Reads a template file into memory
     * @param path The file path or descriptor, passed directly to `FS.readFileSync` 
     * @returns A new `Layout` object, for which `render` can be called within Gulp tasks. 
     */
    static read(path: FS.PathOrFileDescriptor) { 
        return new Layout(FS.readFileSync(path).toString())
    }

    render(options ?: RenderOptions) : RenderStream { 
        return new RenderStream(this.templateContents, options) 
    }
}



interface RenderOptions { 
    /**
     * The "view" object passed to Mustache;
     * i.e. the variable bindings provided during the render. 
     */
    view ?: any,

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


class RenderStream extends Stream.Transform { 

    templateContents: string
    options: RenderOptions

    constructor(templateContents: string, options: RenderOptions = {}) { 
        super({ objectMode: true })
        this.templateContents = templateContents
        this.options = options
    }

    _transform(input: Vinyl, encoding: BufferEncoding, callback: Stream.TransformCallback): void {
        if(input.isNull()) { 
            this.push(input); 
            return callback(); 
        }
        if(input.isStream()) { 
            this.emit('error', new PluginError('gulp-mustache-layout', 'Streams are not yet supported'))
            return callback();
        }

        // Ignore partials, so that globs don't render them independently
        if(input.basename.startsWith("_")) return callback()

        const loadPartial = (name: string) => { 
            if(name == 'yield') return input.contents?.toString(); 

            const path = Path.resolve(input.dirname, name + '.mustache')
            return FS.readFileSync(path).toString() 
        }

        try { 
            
            let output = Mustache.render(
                this.templateContents, 
                this.options.view,
                loadPartial
            )

            const parse = Path.parse(input.path) 
            input.contents = Buffer.from(output) 
            input.path = parse.dir + Path.sep 
                + (this.options.outputName ?? parse.base) 
                + (this.options.outputExtension ?? '.htm')
            
            this.push(input) 

        }
        catch(err) { 
            if(err instanceof Error) this.emit('error', new PluginError('gulp-mustache-layout', err, { showStack: true }))
            else this.emit('error', new PluginError('gulp-mustache-layout', "Error during rendering: " + err))
        }

        callback()
    }

}
