"use strict";

// To install: npm install -g babel-cli / npm install babel-preset-react babel-preset-es2015
// To compile: babel --presets react,es2015 render.jsx --out-file render.js --minified

function createInitialStateAndSubscribe(obj, props) {
  return function() {
    const state = {};
    props.forEach((prop) => {
      this.props[obj][prop].subscribe(() => {
        this.setState({ [prop]: this.props[obj][prop]() });
      });
      state[prop] = this.props[obj][prop]();
    });
    return state;
  };
}

function createOnChange(obj, prop, src) {
  return function(e) {
    const newValue = e.target[src || "value"];
    this.props[obj][prop](newValue);
    this.setState({ [prop]: newValue });
  };
}

function createOnClick(obj, fun, ctx) {
  return function(e) {
    e.preventDefault();
    this.props[obj][fun](this.props[ctx], e);
  };
}

const App = React.createClass({
  getInitialState: createInitialStateAndSubscribe("app", ["loginPageVisible", "mainPageVisible"]),
  onChangeMasterPassword: createOnClick("app", "changeMasterPassword"),
  componentDidMount: function() {
    window.addEventListener("scroll", this.props.app.resetInactivityTimeout);
  },
  render: function() {
    const context = this.props.context;
    const loginPage = this.state.loginPageVisible ? (
      <div>
        <LoginForm loginForm={context.loginForm}/>
        <div className="small important">Important: Only use PassWeb on trusted devices!</div>
        <FaqList faqs={context.faqs}/>
        <div className="small separate"><a href="//github.com/DavidAnson/PassWeb">Open Source</a>. Copyright &copy; 2014-2016 by <a href="//dlaa.me/">David Anson</a>.</div>
      </div>
    ) : null;
    const mainPage = this.state.mainPageVisible ? (
      <div>
        <FilterBox userData={context.userData}/>
        <EntriesList userData={context.userData}/>
        <EntryForm entryForm={context.entryForm}/>
        <div className="small"><strong>Reminder</strong>: PassWeb resets after 3 minutes of inactivity. Unsaved edits are discarded, so save promptly!</div>
        <div className="separate"></div>
        <div className="small">
          <a onClick={this.onChangeMasterPassword} href="#">[Change master password]</a>
        </div>
      </div>
    ) : null;
    const resetInactivityTimeout = context.app.resetInactivityTimeout;
    return (
      <div onChangeCapture={resetInactivityTimeout} onClickCapture={resetInactivityTimeout}>
        <h1>PassWeb</h1>
        {loginPage}
        {mainPage}
        <Status status={context.status}/>
      </div>
    );
  }
});

const LoginForm = React.createClass({
  getInitialState: createInitialStateAndSubscribe("loginForm", ["username", "password", "cache"]),
  onChangeUsername: createOnChange("loginForm", "username"),
  onChangePassword: createOnChange("loginForm", "password"),
  onChangeCache: createOnChange("loginForm", "cache", "checked"),
  onSubmit: createOnClick("loginForm", "submit"),
  render: function() {
    return (
      <form id="loginForm" onSubmit={this.onSubmit} autoComplete="off">
        <div>
          <input type="text" value={this.state.username} onChange={this.onChangeUsername} placeholder="Name" required autoComplete="off"/>
        </div>
        <div>
          <input type="password" value={this.state.password} onChange={this.onChangePassword} placeholder="Password" autoFocus autoComplete="off"/>
        </div>
        <div>
          <input type="submit" value="Unlock"/>
        </div>
        <div>
          <label>
            <input type="checkbox" checked={this.state.cache} onChange={this.onChangeCache} autoComplete="off"/>
            <span>Cache encrypted passwords for offline use</span>
          </label>
        </div>
      </form>
    );
  }
});

const FaqList = function(props) {
  const nodes = props.faqs.map((faq, index) => {
    return (
      <li key={index}>
        <div className="block">
          <div className="question">{faq.question}</div>
          <div className="answer">{faq.answer}</div>
        </div>
      </li>
    );
  });
  return (
    <div id="faqs" className="separate">
      <ul>
        {nodes}
      </ul>
    </div>
  );
};

const FilterBox = React.createClass({
  getInitialState: createInitialStateAndSubscribe("userData", ["filter"]),
  onChangeFilter: createOnChange("userData", "filter"),
  render: function() {
    return (
      <input id="filter" type="text" value={this.state.filter} onChange={this.onChangeFilter} placeholder="Search" accessKey="s"/>
    );
  }
});

const EntriesList = React.createClass({
  componentDidMount: function() {
    this.props.userData.visibleEntries.subscribe(() => {
      this.forceUpdate();
    });
  },
  render: function() {
    const userData = this.props.userData;
    const visibleEntries = userData.visibleEntries().map(function(visibleEntry) {
      const entry = visibleEntry.entry;
      const visible = visibleEntry.visible;
      return (
        <EntryWrapper key={entry.id} entry={entry} userData={userData} visible={visible}/>
      );
    });
    return (
      <ul id="entriesList">
        {visibleEntries}
      </ul>
    );
  }
});

const EntryWrapper = React.createClass({
  shouldComponentUpdate: function(nextProps, nextState) {
    return (this.props.entry !== nextProps.entry) || (this.props.visible !== nextProps.visible);
  },
  render: function() {
    const entry = this.props.entry;
    const userData = this.props.userData;
    return (
      <li style={{ display: this.props.visible ? null : "none" }}>
        <EntryItem entry={entry} userData={userData}/>
      </li>
    );
  }
});

const EntryItem = React.createClass({
  getInitialState: function() {
    return {
      drawerOpen: false
    };
  },
  onClickEdit: createOnClick("userData", "edit", "entry"),
  onClickRemove: createOnClick("userData", "remove", "entry"),
  onClickCopyusername: createOnClick("userData", "copyusername", "entry"),
  onClickCopypassword: createOnClick("userData", "copypassword", "entry"),
  onToggleDrawer: function(e) {
    e.preventDefault();
    this.props.userData.togglenotes(this.props.entry);
    this.setState({ drawerOpen: !this.state.drawerOpen });
  },
  shouldComponentUpdate: function(nextProps, nextState) {
    return (this.props.entry !== nextProps.entry) || (this.state.drawerOpen !== nextState.drawerOpen);
  },
  render: function() {
    const dataMask = "********";
    const entry = this.props.entry;
    const weakMessage = entry.reused || entry.weak;
    const titleTip = entry.id + (entry.insecure ? " [Insecure: Not HTTPS]" : "");
    const titleContent = entry.website ? (
      <a href={entry.website} title={titleTip} target="_blank" rel="noopener">{entry.id}</a>
    ) : (
      <span title={titleTip}>{entry.id}</span>
    );
    const content = this.state.drawerOpen ? (
      <pre className="content">{entry.notes}</pre>
    ) : null;
    const notes = entry.notes ? (
      <div className="notes">
        {content}
        <div className="drawer">
          <a onClick={this.onToggleDrawer} href="#" className="handle"><img src="Resources/ArrowDown.svg" alt="Notes" title="Notes" className="icon"/></a>
        </div>
      </div>
    ) : null;
    return (
      <div className="block">
        <div className="banner">
          <div className={"title ellipsis" + (entry.insecure ? " insecure" : "")}>{titleContent}</div>
          <a onClick={this.onClickEdit} href="#" className="edit"><img src="Resources/Edit.svg" alt="Edit" title="Edit" className="icon"/></a>
          <a onClick={this.onClickRemove} href="#" className="remove"><img src="Resources/Close.svg" alt="Delete" title="Delete" className="icon"/></a>
        </div>
        <div className="userpass">
          <div>&nbsp;</div>
          <div className="username"><a onClick={this.onClickCopyusername} href="#" className="ellipsis">{entry.username}</a></div>
          <div className={"password" + (weakMessage ? " weak" : "")} title={weakMessage}><a onClick={this.onClickCopypassword} data-mask={dataMask} href="#" className="ellipsis">{dataMask}</a></div>
        </div>
        {notes}
      </div>
    );
  }
});

const EntryForm = React.createClass({
  getInitialState: createInitialStateAndSubscribe("entryForm", ["expanded", "id", "username", "password", "website", "notes", "generating", "passwordLength", "passwordLower", "passwordUpper", "passwordNumbers", "passwordNumbers", "passwordSymbols"]),
  onChangeId: createOnChange("entryForm", "id"),
  onChangeUsername: createOnChange("entryForm", "username"),
  onChangePassword: createOnChange("entryForm", "password"),
  onChangeWebsite: createOnChange("entryForm", "website"),
  onChangeNotes: createOnChange("entryForm", "notes"),
  onChangePasswordLength: createOnChange("entryForm", "passwordLength"),
  onChangePasswordLower: createOnChange("entryForm", "passwordLower", "checked"),
  onChangePasswordUpper: createOnChange("entryForm", "passwordUpper", "checked"),
  onChangePasswordNumbers: createOnChange("entryForm", "passwordNumbers", "checked"),
  onChangePasswordSymbols: createOnChange("entryForm", "passwordSymbols", "checked"),
  onGeneratePassword: createOnClick("entryForm", "generatePassword"),
  onClickSubmit: createOnClick("entryForm", "clickSubmit", null),
  onSubmit: createOnClick("entryForm", "submit"),
  onExpand: createOnClick("entryForm", "expand"),
  onClear: createOnClick("entryForm", "clear"),
  componentDidUpdate: function(prevProps, prevState) {
    if (prevState.expanded !== this.state.expanded) {
      this.formRef.scrollIntoView();
      this.titleRef.focus();
    }
    if ((prevState.generating !== this.state.generating) && this.state.generating) {
      this.passwordRef.select();
    }
  },
  enableClickToSubmit: function() {
    if (this.updateRef && this.submitRef) {
      this.updateRef.submit = this.submitRef;
      this.updateRef = this.submitRef = null;
    }
  },
  render: function() {
    let passwordSettings = null;
    if (this.state.generating) {
      const radioLabels = ["8", "12", "16", "24", "32"].map((len) => {
        const name = "passwordLength";
        const id = name + len;
        return (
          <span key={len} className="radioLabel">
            <input type="radio" name={name} checked={this.state.passwordLength === len} onChange={this.onChangePasswordLength} value={len} id={id}/><label htmlFor={id}>{len}</label>
          </span>
        );
      });
      const checkboxLabel = (id, label) => {
        const handler = this["onChangeP" + id.slice(1)];
        return (
          <span className="checkLabel">
            <input type="checkbox" checked={this.state[id]} onChange={handler} id={id}/><label htmlFor={id}>{label}</label>
          </span>
        );
      };
      passwordSettings = (
        <div className="passwordSettings">
          <div>
            {radioLabels}
          </div>
          <div>
            {checkboxLabel("passwordLower", "Lower-case")}
            {checkboxLabel("passwordUpper", "Upper-case")}
          </div>
          <div>
            {checkboxLabel("passwordNumbers", "Numbers")}
            {checkboxLabel("passwordSymbols", "Symbols")}
          </div>
        </div>
      );
    }
    const content = this.state.expanded ? (
      <div>
        <div>
          <input type="text" value={this.state.id} onChange={this.onChangeId} accessKey="n" placeholder="Title" required autoFocus ref={e => this.titleRef = e}/>
        </div>
        <div>
          <input type="text" value={this.state.username} onChange={this.onChangeUsername} placeholder="User name"/>
        </div>
        <div>
          <input type={this.state.generating ? "text" : "password"} value={this.state.password} onChange={this.onChangePassword} placeholder="Password" required ref={e => this.passwordRef = e}/>
        </div>
        <div>
          <input type="url" value={this.state.website} onChange={this.onChangeWebsite} placeholder="URL"/>
        </div>
        <div>
          <textarea value={this.state.notes} onChange={this.onChangeNotes} rows="3" placeholder="Notes"></textarea>
        </div>
        <div className="buttons">
          <a onClick={this.onGeneratePassword} href="#" className="generate" accessKey="g"><img src="Resources/Lock.svg" alt="Generate password" title="Generate password" className="icon"/></a>
          <a onClick={this.onClickSubmit} href="#" className="update" ref={e => { this.updateRef = e; this.enableClickToSubmit(); }}><img src="Resources/Save.svg" alt="Save" title="Save" className="icon"/></a>
          <a onClick={this.onClear} href="#" className="clear"><img src="Resources/Undo.svg" alt="Clear" title="Clear" className="icon"/></a>
        </div>
        <input type="submit" tabIndex="-1" ref={e => { this.submitRef = e; this.enableClickToSubmit(); }}/>
        {passwordSettings}
      </div>
    ) : (
      <div>
        <a onClick={this.onExpand} accessKey="n" href="#">New entry...</a>
      </div>
    );
    return (
      <form id="entryForm" onSubmit={this.onSubmit} autoComplete="off" ref={e => this.formRef = e}>
        {content}
      </form>
    );
  }
});

const Status = React.createClass({
  getInitialState: createInitialStateAndSubscribe("status", ["progress", "errors"]),
  onRemove: function(error, e) {
    e.preventDefault();
    this.props.status.removeError(error);
  },
  render: function() {
    const waiting = this.state.progress ? (
      <div>
        <img src="Resources/Waiting.svg" alt="Busy" title="Busy" className="icon"/>
        <span>{this.state.progress}</span>
      </div>
    ) : null;
    const errors = this.state.errors.map((error) => {
      return (
        <li key={error.id}>
          <span className="dismiss">
            <a onClick={this.onRemove.bind(this, error)} href="#" className="remove"><img src="Resources/Close.svg" alt="Dismiss" title="Dismiss" className="icon"/></a>
          </span>
          <img src="Resources/Warning.svg" alt="Warning" title="Warning" className="icon"/>
          <span>{error.message}</span>
        </li>
      );
    });
    return (
      <div id="status">
        {waiting}
        <ul>
          {errors}
        </ul>
      </div>
    );
  }
});

function render(context) {
  ReactDOM.render(
    <App context={context} app={context.app}/>,
    document.getElementById("appContainer")
  );
}

// Simple replacement for Knockout.js observable
function observable(initial) {
  let value = initial;
  let observers = [];
  const obj = function(newValue, forceUpdate) {
    if (!arguments.length) {
      return value;
    }
    if ((value !== newValue) || forceUpdate) {
      value = newValue;
      observers.forEach((observer) => {
        observer(value);
      });
    }
  };
  obj.subscribe = (cb) => {
    observers.push(cb);
  };
  return obj;
}

// Simple replacement for jQuery ajax
function ajax(uri, type, data, done, fail, always) {
  const noop = () => {};
  done = done || noop;
  fail = fail || noop;
  always = always || noop;
  const request = new XMLHttpRequest();
  request.onload = () => {
    if (request.status >= 200 && request.status < 300) {
      done(request.responseText);
    } else {
      fail();
    }
  }
  request.onerror = () => {
    fail();
  };
  request.onloadend = () => {
    always();
  };
  const encodeFormUrlComponent = (str) => {
    return encodeURIComponent(str).replace("%20", "+");
  };
  let urlencoded = Object.keys(data)
    .filter((key) => {
      return (data[key] !== undefined) && (data[key] !== null);
    })
    .map((key) => {
      return encodeFormUrlComponent(key) + "=" + encodeFormUrlComponent(data[key]);
    })
    .join("&");
  if (type.toLowerCase() === "get") {
    uri += "?" + urlencoded + "&_=" + Date.now();
    urlencoded = null;
  }
  request.open(type, uri);
  request.setRequestHeader("X-Requested-With", "XMLHttpRequest");
  if (urlencoded) {
    request.setRequestHeader("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
  }
  request.send(urlencoded);
}
