# floomatic

A headless [Floobits](https://floobits.com/) workspace and disk watcher. Handy for shipping changes to a testing server.

[![NPM version](https://badge.fury.io/js/floomatic.svg)](http://badge.fury.io/js/floomatic)


## Setup

1.
    npm install floomatic

2. Go to [your Floobits user settings](https://floobits.com/dash/settings).
3. Copy your `~/.floorc` from that page. Save it locally to `~/.floorc`.

Now you're all set!


## Usage

### Share a directory

    floomatic --share /path/to/share


### Join a workspace

    floomatic --join https://floobits.com/owner_name/workspace_name

If you don't want to ship local changes to the Floobits server, use `--read-only`

    floomatic --read-only --join https://floobits.com/owner_name/workspace_name


## Hooks

floomatic reads hooks from .floo in the base path of the shared directory. The format of .floo is:

    {
        "url": "https://floobits.com/owner/workspace",
        "hooks": {
            "**": "/etc/init.d/apache restart",
            "static/less/**": "less static/less/*"
        }
    }

The hooks in this example will restart apache whenever any file in the workspace gets changed, and will regenerate css from less whenever less files change. Patterns are matched by [minimatch](https://github.com/isaacs/minimatch/).
