const DEFAULT_MAIN_TEX: &str = r#"% !TeX program = xelatex
% !TeX encoding = UTF-8 Unicode
% LatoTex starter template
\documentclass[11pt,a4paper]{article}
\usepackage{amsmath,amssymb}
\usepackage{booktabs}
\usepackage{hyperref}
\usepackage{xcolor}

\title{LatoTex Quick Start}
\author{LatoTex User}
\date{\today}

\begin{document}
\maketitle

\section{Welcome to LatoTex}
LatoTex provides \textbf{agent-assisted writing} and \textbf{native LaTeX compilation}.

\subsection{Equation example}
\begin{equation}
  \int_0^1 x^2\,dx = \frac{1}{3}
\end{equation}

\subsection{Table example}
\begin{table}[h]
  \centering
  \begin{tabular}{lcc}
    \toprule
    Metric & Value A & Value B \\
    \midrule
    Sample 1 & 12.3 & 45.6 \\
    Sample 2 & 78.9 & 10.1 \\
    \bottomrule
  \end{tabular}
  \caption{Default LatoTex template sample}
\end{table}

\subsection{Next steps}
Create new files from the explorer, then use the Agent panel to iterate on your document.

\end{document}
"#;

const RESEARCH_PAPER_MAIN_TEX: &str = r#"% !TeX program = xelatex
% !TeX encoding = UTF-8 Unicode
\documentclass[11pt,a4paper]{article}
\usepackage{amsmath,amssymb}
\usepackage{booktabs}
\usepackage{hyperref}

\title{A Reproducible Research Paper}
\author{Your Name}
\date{\today}

\begin{document}
\maketitle

\begin{abstract}
This offline sample provides a small, reproducible structure that compiles before you add remote sources or optional packages.
\end{abstract}

\section{Introduction}
State the research question, explain why it matters, and summarize the contribution. The local bibliography file contains editable citation metadata for later use.

\section{Method}
Describe the data, assumptions, and procedure. For example, the sample mean is
\begin{equation}
  \bar{x} = \frac{1}{n}\sum_{i=1}^{n} x_i.
\end{equation}

\section{Results}
\begin{table}[h]
  \centering
  \begin{tabular}{lcc}
    \toprule
    Condition & Mean & Std. dev. \\
    \midrule
    Baseline & 0.72 & 0.08 \\
    Proposed & 0.81 & 0.05 \\
    \bottomrule
  \end{tabular}
  \caption{Replace these values with your measured results.}
\end{table}

\section{Discussion}
Interpret the evidence, document limitations, and identify the next experiment.

\begin{thebibliography}{1}
\bibitem{lamport1994}
Leslie Lamport.
\newblock \emph{LaTeX: A Document Preparation System}.
\newblock Addison-Wesley, 1994.
\end{thebibliography}

\end{document}
"#;

const RESEARCH_PAPER_REFERENCES: &str = r#"@book{lamport1994,
  author    = {Leslie Lamport},
  title     = {LaTeX: A Document Preparation System},
  year      = {1994},
  publisher = {Addison-Wesley}
}
"#;

fn write_if_missing(path: &Path, content: &str) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    fs::write(path, content).map_err(|error| error.to_string())
}

fn write_workspace_template_files(
    root: &Path,
    template: Option<ProjectTemplate>,
) -> Result<(), String> {
    let project_name = root
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "LatoTex Project".to_string());

    match template {
        Some(ProjectTemplate::ResearchPaper) => {
            write_if_missing(&root.join("main.tex"), RESEARCH_PAPER_MAIN_TEX)?;
            write_if_missing(&root.join("references.bib"), RESEARCH_PAPER_REFERENCES)?;
            write_if_missing(
                &root.join("QUICKSTART.md"),
                "# Three steps\n\n1. Open `main.tex`.\n2. Compile the manuscript.\n3. Read the generated PDF.\n\nEverything in this sample is local and editable.\n",
            )?;
            write_if_missing(
                &root.join("README.md"),
                &format!(
                    "# {project_name}\n\nOffline research-paper sample created by LatoTex.\n\n- `main.tex`: compilable manuscript\n- `references.bib`: local citation metadata\n- `QUICKSTART.md`: first-PDF checklist\n"
                ),
            )?;
        }
        None => {
            write_if_missing(&root.join("main.tex"), DEFAULT_MAIN_TEX)?;
            write_if_missing(
                &root.join("README.md"),
                &format!(
                    "# {project_name}\n\nManaged by LatoTex.\n\n## Structure\n\n- `main.tex`: default LaTeX entry file\n- `.latotex/`: workspace metadata\n"
                ),
            )?;
        }
    }
    Ok(())
}
