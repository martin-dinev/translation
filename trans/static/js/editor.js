var task_id, task_text, translation_text;
var save_task_url, task_version_url, access_edit_translate_url, home_page_url, finish_translation_url, list_version_url,
    release_task_url;
var csrf_token;
var last_time_get_edit_token;
var latest_translation_text;
var simplemde;
var left_plain_text_box_id;
var direction, language;
var last_autosaved_text;
var previewInterval;
var spellChecking = false;

// Settings
var markdown_render_interval = 100;
var autosave_interval = 30 * 1000;
var update_token_interval = 60 * 1000;


$(document).ready(function () {

    if (direction == 'rtl') {
        left_plain_text_box_id = 'left_rtl_plain_text_box';
        $('#' + left_plain_text_box_id).moratab('', {strings: {help: ''}});
    } else {
        left_plain_text_box_id = 'left_ltr_plain_text_box';
        $('#' + left_plain_text_box_id).html('');
        simplemde = new SimpleMDE({
            element: document.getElementById('left_ltr_plain_text_box'),
            status: false,
            toolbar: false,
            spellChecker: false,
            initialValue: ''
        });
    }
    getEditTranslateAccess(initial);

});


function loadTranslationText(text) {

    if (direction == 'rtl') {
        $('#' + left_plain_text_box_id).html('');
        $('#' + left_plain_text_box_id).moratab(text, {strings: {help: ''}});
    } else {
        $('#' + left_plain_text_box_id).html('');
        simplemde.value(text)
        simplemde.codemirror.refresh()
    }
}

function initial() {

    $('#left_rendered_text_box').css('direction', direction);
    task_text = $("#temp").html();
    translation_text = currentTranslationText();
    latest_translation_text = '';
    last_autosaved_text = currentTranslationText();
    setInterval(autoSave, autosave_interval)
    setInterval(onlinePreview, markdown_render_interval);
    onPreviewClick();
}

function currentTranslationText() {
    if (direction == 'rtl') return $('#' + left_plain_text_box_id).text();
    return simplemde.value();
}

/*
 * Preprocess the text before rendering to preview and to pdf. Uses ' ' as the delimiter for tokenization. Does two passes of the text, one to load the variables, and a second to substitute the variables.
 * 1. variable definition
 *   - #{0-6} %%START_VAR <var_name> [%%<par_name>]* %% <var_single_line_content>
 *   - #{0-6} %%START_VAR <var_name> [%%<par_name>]* %% \n <var_multiline_content> \n #{0-6} %%END_VAR
 * where <var_name> is the name of the variable, <par_name> is the name of the parameter, and <var_content> is the content of the variable. The variable content can be either single line or multi-line. The variable content can contain parameters from the parameter group used as $<par_name>. <par_name> can contain only alphanumeric characters and underscores and must start with %%.
 * 2. variable use
 *   - #{0-6} %%USE_VAR <var_name> [%% <par_value>]* %%
 * where <var_name> is the name of the variable, and <par_value> is the value of the parameter. There should be as many parameters as in the variable definition.
 *
 * The optional hashtags at the beginning of the line are ignored and are only for displaying.
 *
 * @param {string} text - the text to be preprocessed
 */
function preprocess(text, request_logs = false) {
    let variable_map = {};
    let lines = text.split("\n");
    let startToken = "%%START_VAR";
    let endToken = "%%END_VAR";
    let useToken = "%%USE_VAR";

    // first pass to save variables to the map

    let filtered = [];

    for (let line_index = 0; line_index < lines.length; line_index++) {
        let line = lines[line_index];
        let trimmed = line.trim();
        let tokens = trimmed.split(" ");
        tokens = tokens.filter(el => el !== "");

        if (tokens.length === 0) {
            filtered.push(line);
            continue;
        }

        // check if the line starts with hashtag symbols
        if (tokens[0].match(/^#{1,6}$/)) tokens.shift();

        // check if the line starts with the start token
        if (tokens[0] !== startToken) {
            filtered.push(line);
            continue;
        }
        // remove the start token
        tokens.shift();

        // get the variable name
        let var_name = tokens.shift();

        // save the variable into the map
        variable_map[var_name] = {content: "", parameters: []};

        // search for parameters until the terminating %% token
        let par_name = undefined;
        for (par_name = tokens.shift(); par_name !== undefined && par_name !== "%%"; par_name = tokens.shift()) {
            if (!par_name.startsWith("%%")) {
                // the parameter name is not valid
                if (request_logs) console.error("Invalid parameter name: " + par_name + " in variable: " + var_name + "! (doesn't start with %%)");
                par_name = undefined;
                break;
            }
            if (par_name.substring(2).match(/^[a-zA-Z0-9_]+$/) === null) {
                // the parameter name is not valid
                if (request_logs) console.error("Invalid parameter name: " + par_name + " in variable: " + var_name + "! (contains invalid characters)");
                par_name = undefined;
                break;
            }
            variable_map[var_name].parameters.push(par_name);
        }
        // check if the parameters were valid
        if (par_name === undefined) {
            // the parameters were not valid
            if (request_logs) console.error("Didn't parse parameters terminator: `%%`, it is either missing or there was a parameter name that couldn't be parsed! (variable: " + var_name + ")");
            filtered.push(line);
            continue;
        }

        // get the variable content
        let var_content = undefined;
        if (tokens.length !== 0) {
            // the variable content is on the same line
            var_content = tokens.join(" ");
        } else {
            // the variable content is on multiple lines
            let line_index_2 = line_index;
            var_content = "";
            for (line_index_2++; line_index_2 < lines.length; line_index_2++) {
                line = lines[line_index_2];
                tokens = line.trim().split(" ").filter(el => el !== "");

                if (tokens.length > 0 && tokens[0].match(/^#{1,6}$/)) {
                    tokens.shift();
                }
                if (tokens.length === 1 && tokens[0] === endToken) {
                    break;
                } else {
                    var_content += line + "\n";
                }
            }
            if (line_index_2 === lines.length) {
                // the variable content was not terminated
                if (request_logs) console.error("Didn't parse variable content terminator: `" + endToken + "`! (variable: " + var_name + ")");
                var_content = undefined;
                filtered.push(line);
            } else {
                line_index = line_index_2;
            }
        }
        if (var_content !== undefined) {
            variable_map[var_name].content = var_content;
        } else {
            // the variable content was not valid
            if (request_logs) console.error("The variable content was not valid! (variable: " + var_name + ")");
        }
    }


    // second pass to replace variables
    let result = [];
    for (let line_index = 0; line_index < filtered.length; line_index++) {
        let line = filtered[line_index];
        let tokens = line.split(" ").filter(el => el !== "");
        if (tokens.length === 0) {
            result.push(line);
            continue;
        }
        if (tokens[0].match(/^#{1,6}$/)) tokens.shift();
        if (tokens.length === 0 || tokens[0] !== useToken) {
            // the line is not a variable use
            result.push(line);
            continue;
        }
        // remove the use token
        tokens.shift();

        // get the variable name
        let var_name = tokens.shift();
        if (variable_map[var_name] === undefined) {
            // no such variable
            if (request_logs) console.error("No such variable! (variable: " + var_name + ")");
            result.push(line);
            continue;
        }

        // get the parameters
        let rest = line.substring(line.search(startToken) + startToken.length);
        rest = rest.substring(rest.search(var_name) + var_name.length);
        let parameter_values = rest.split("%%");
        parameter_values.shift();
        parameter_values.pop();

        if (parameter_values.length !== variable_map[var_name].parameters.length) {
            // the variable use has wrong number of parameters
            if (request_logs) console.error("The variable use has wrong number of parameters! (variable: " + var_name + ")");
            result.push(line);
            continue;
        }

        let indexes = {}
        for (let i = 0; i < variable_map[var_name].parameters.length; i++) {
            indexes[variable_map[var_name].parameters[i]] = i;
        }

        // replace the parameters in the variable content
        let var_content = variable_map[var_name].content;
        let result_content = [];
        while(var_content.length > 0) {
            let nearest_parameter = undefined;
            let nearest_parameter_index = undefined;
            for (let i = 0 ; i < variable_map[var_name].parameters.length; i++) {
                let parameter = variable_map[var_name].parameters[i];
                let index = var_content.indexOf(parameter);
                if(index === -1)continue;

                let next_char = undefined;
                if(index+parameter.length < var_content.length)
                    next_char = var_content[index+parameter.length];
                if(next_char !== undefined && next_char.match(/[a-zA-Z0-9_]/))continue;

                if ((nearest_parameter === undefined || index < nearest_parameter_index)) {
                    nearest_parameter = parameter;
                    nearest_parameter_index = index;
                }
            }
            if (nearest_parameter === undefined) {
                result_content.push(var_content);
                break;
            }else{
                let parts = [
                    var_content.substring(0, nearest_parameter_index),
                    var_content.substring(nearest_parameter_index + nearest_parameter.length)
                ];
                result_content.push(parts[0]);
                result_content.push(parameter_values[indexes[nearest_parameter]]);
                var_content = parts[1];
            }
        }
        result.push(result_content.join(""));
    }

    return result.join("\n");
}


function renderMarkdown(id, text) {
    $('#' + id).html(marked(preprocess(text)));
    renderMathInElement(document.getElementById(id));
}

function onlinePreview() {
    current_text = currentTranslationText();
    if (current_text != latest_translation_text) {
        latest_translation_text = current_text;
        renderMarkdown('preview', current_text)
    }
}

function switchTab(id) {
    var tabs = ['preview', 'isc-preview', 'isc-markdown'];
    for (var i = 0; i < 3; i++) {
        $('#' + tabs[i]).hide();
        $('#' + tabs[i] + '-btn').removeClass('btn-active');
    }
    $('#' + id).show();
    $('#' + id + '-btn').addClass('btn-active');
}

function onPreviewClick() {
    current_text = currentTranslationText();
    renderMarkdown('preview', current_text);
    switchTab('preview');
}

function onIscPreviewClick() {
    renderMarkdown('isc-preview', task_text);
    switchTab('isc-preview');
}

function onIscMarkdownClick() {
    $('#isc-markdown').html(task_text);
    switchTab('isc-markdown');
}

function autoSave(on_unleash = false, callback = null) {
    saveVersion(true, on_unleash, callback);
}

function saveAndGo(url) {
    saveVersion(true, false, function () {
        window.location.href = url;
    });
}


function setEditToken(edit_token) {
    last_time_get_edit_token = new Date();
    sessionStorage.setItem('edit_translate_token_' + task_id, edit_token);
}


function saveVersion(autosave = false, on_unleash = false, callback = null) {
    current_trans_text = currentTranslationText();
    if (autosave && last_autosaved_text == current_trans_text) {
        if (callback) callback();
        return;
    }
    var edit_token = sessionStorage.getItem('edit_translate_token_' + task_id)
    $.ajax({
        async: !on_unleash, url: save_task_url, data: {
            content: currentTranslationText(),
            id: task_id,
            saved: !autosave,
            edit_token: edit_token,
            csrfmiddlewaretoken: csrf_token
        }, type: "POST", success: function (response) {
            if (response.can_edit == false) handleAccessDenied(); else {
                last_autosaved_text = current_trans_text;
                setEditToken(response.edit_token)
                if (callback) callback(); else if (!autosave) ToastrUtil.success('Successfully saved!');
            }
        }
    });
}

function getEditTranslateAccess(callback) {
    var edit_token = sessionStorage.getItem('edit_translate_token_' + task_id)
    var originalTranslationText = currentTranslationText();
    $.ajax({
        // TODO: remove async = false
//        async: false,
        url: access_edit_translate_url, data: {
            id: task_id, edit_token: edit_token, csrfmiddlewaretoken: csrf_token
        }, type: "POST", success: function (response) {
            if (response.can_edit == false) {
                handleAccessDenied();
                return;
            }

            setEditToken(response.edit_token);

            // Translation might've changed since this ajax call is done asynchronously.
            var translationText = currentTranslationText();

            if (originalTranslationText.length === 0 && translationText.length === 0) {
                // Initial load or refresh (without further update), just load the content.
                loadTranslationText(response.content);
            } else if (edit_token !== response.edit_token) {
                // If token stays the same, no other session has tried to edit the translation since
                // older token can't be reused once another token has been issued. Hence, the more
                // expensive translation comparison doesn't need to be done as often.

                var canKeepCurrentTranslationState = originalTranslationText === response.content;
                if (!canKeepCurrentTranslationState) {
                    ToastrUtil.info('Translation has changed since last edit. Refreshing translation.');
                    loadTranslationText(response.content);
                }
            }

            if (callback) callback();
        }, error: function () {
            handleAccessDenied('Connection error!');
        }
    });
}

function releaseToken() {
    var edit_token = sessionStorage.getItem('edit_translate_token_' + task_id)
    $.ajax({
        async: false, url: finish_translation_url, data: {
            id: task_id, edit_token: edit_token, csrfmiddlewaretoken: csrf_token
        }, type: "POST", success: function (response) {
        }, error: function () {
        }
    });
};

function handleAccessDenied(message = '') {
    msg = message || "The task is open somewhere else!"
    bootbox.alert({
        // title: 'Alert',
        message: '<b>' + msg + '</b>', buttons: {
            ok: {label: 'Back to Home'},
        }, callback: function (result) {
            window.location.replace(home_page_url);
        }
    });
}

function checkIfCanChange() {
    current_date = new Date();
    if ((current_date - last_time_get_edit_token) > update_token_interval) getEditTranslateAccess();
}

window.onbeforeunload = function () {
    autoSave(true, releaseToken);
};


function onChangeSpellChecking() {
    spellChecking = !spellChecking;
    var value = simplemde.value();

    /* reset simpleMDE container */
    var element = document.getElementById("left_text_box_container");
    while (element.firstChild) {
        element.removeChild(element.firstChild);
    }
    var textarea = document.createElement('textarea');
    textarea.setAttribute('id', 'left_ltr_plain_text_box');
    element.appendChild(textarea);

    /* new simpleMDE */
    simplemde = new SimpleMDE({
        element: document.getElementById("left_ltr_plain_text_box"),
        status: false,
        toolbar: false,
        spellChecker: spellChecking,
        initialValue: value
    });
}

function release() {
    autoSave();
    bootbox.prompt({
        title: 'Release Note:', buttons: {
            confirm: {label: 'Release'},
        }, callback: function (result) {
            if (result) sendRelease(result); else if (result == '') {
                ToastrUtil.error('Release note cannot be empty.');
            }
        }
    });
}

function sendRelease(note) {
    $.ajax({
        url: release_task_url, data: {
            release_note: note, csrfmiddlewaretoken: csrf_token
        }, type: "POST", success: function (response) {
            last_saved_content = simplemde.value();
            ToastrUtil.success('Task released!');
        }, error: function (response) {
            ToastrUtil.error('Release failed.');
        }
    });
}
