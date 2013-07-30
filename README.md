# Flegmatic

A headless [Floobits](https://floobits.com/) workspace and disk watcher. Handy for shipping changes to a testing server.

## Setup

1.
    npm install flegmatic

2. Go to [your Floobits user settings](https://floobits.com/dash/settings).
3. Copy your `~/.floorc` from that page. Save it locally to `~/.floorc`.

Now you're all set!


## Usage

### Share a directory

    flegmatic --share /path/to/share


### Join a workspace

    flegmatic --join https://floobits.com/r/owner_name/workspace_name

If you don't want to ship local changes to the Floobits server, use `--read-only`

    flegmatic --read-only --join https://floobits.com/r/owner_name/workspace_name


## Hooks

Flegmatic reads hooks from .floo in the base path of the shared directory. The format of .floo is:

    {
        "url": "https://floobits.com/r/owner/workspace",
        "hooks": {
            "**": "/etc/init.d/apache restart",
            "static/less/**": "less static/less/*"
        }
    }

The hooks in this example will restart apache whenever any file in the workspace gets changed, and will regenerate css from less whenever less files change. Patterns are matched by [minimatch](https://github.com/isaacs/minimatch/).
